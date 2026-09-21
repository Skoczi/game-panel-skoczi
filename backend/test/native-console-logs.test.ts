import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { DatabaseSync } from 'node:sqlite';
import { loadWithMocks } from './loadWithMocks.js';
import { migration } from '../src/database/migrations/0003_native_install_progress.js';

test('native console writes one command to owned stdin, rejects foreign/stopped/custom containers', async () => {
    let native = true;
    let owned = true;
    let running = true;
    const writes: string[] = [];
    const module = loadWithMocks('../src/services/gameConsole.ts', {
        '../providers/linuxgsm/console.js': {}, '../providers/ovhcloud/console.js': {},
        '../templates/nativeContract.js': { nativeTemplate: () => native ? {} : null },
        '../utils/docker/ownership.js': { ownsContainer: () => owned },
        '../utils/docker/client.js': { docker: { getContainer: () => ({
            inspect: async () => ({ State: { Running: running }, Config: { OpenStdin: true, Labels: { 'gamepanel.serverId': '7' } } }),
            attach: async () => new Duplex({ read() {}, write(chunk, _, cb) { writes.push(chunk.toString()); cb(); } }),
        }) } },
    }, { setTimeout, clearTimeout });
    const server = { id: 7, provider: 'external', provider_metadata_json: '{}', docker_container_id: 'test' };
    assert.equal((await module.sendGameConsoleCommand(server, ' status ')).ok, true);
    assert.deepEqual(writes, ['status\n']);
    await assert.rejects(module.sendGameConsoleCommand(server, 'status\nquit'), /invalid/);
    running = false;
    await assert.rejects(module.sendGameConsoleCommand(server, 'status'), /running/);
    running = true; owned = false;
    await assert.rejects(module.sendGameConsoleCommand(server, 'status'), /ownership/);
    owned = true; native = false;
    await assert.rejects(module.sendGameConsoleCommand(server, 'status'), /not supported/);
    assert.equal(writes.length, 1);
});

test('native logs retain bounded redacted history, join chunks and flush before cleanup', async () => {
    let stored = '';
    const events: any[] = [];
    const source = new PassThrough();
    const module = loadWithMocks('../src/services/nativeLogs.ts', {
        'node:stream': { PassThrough }, 'node:string_decoder': { StringDecoder },
        '../utils/docker/client.js': { docker: { modem: { demuxStream: (s: PassThrough, out: PassThrough) => s.pipe(out) } } },
        '../database/init.js': { getDatabase: async () => ({ get: async () => stored ? { lines_json: stored } : undefined, run: async (_sql: string, id: number, value: string) => { assert.equal(id, 7); stored = value; } }) },
        '../realtime/bus.js': { bus: { emit: (_event: string, value: any) => events.push(value) } },
    }, { Buffer, setTimeout, clearTimeout, setInterval, clearInterval });
    const capture = await module.captureNativeLogs({ logs: async () => source }, 7, ['private-key']);
    source.write('hello private-');
    source.end('key\rprogress 25%\nRCON password: sensitive\nfinished');
    await capture.finish();
    assert.deepEqual(JSON.parse(stored), ['hello [REDACTED]', 'progress 25%', 'RCON password: [REDACTED]', 'finished']);
    assert.equal(events[0].serverId, 7);
    assert.equal((await module.nativeLogHistory(7)).length, 4);
    assert.equal(module.redactNativeLog('x'.repeat(10000), []).length, 4096);
});

test('progress migration preserves previous rows and accepts native step keys', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE game_servers(id INTEGER PRIMARY KEY); INSERT INTO game_servers VALUES(7);
      CREATE TABLE installation_progress(id INTEGER PRIMARY KEY,server_id INTEGER,progress_percent INTEGER,status TEXT CHECK(status IN ('completed')),error_message TEXT,started_at TEXT,completed_at TEXT,created_at TEXT,updated_at TEXT);
      INSERT INTO installation_progress VALUES(1,7,100,'completed',NULL,'start','end','start','end');`);
    await migration.up({ exec: async (sql: string) => db.exec(sql) } as any);
    assert.equal(db.prepare('SELECT status FROM installation_progress').get()!.status, 'completed');
    db.exec("UPDATE installation_progress SET status='native_step_0'");
    assert.equal(db.prepare('SELECT status FROM installation_progress').get()!.status, 'native_step_0');
    db.close();
});
