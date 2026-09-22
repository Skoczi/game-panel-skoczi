import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGameInfo, queryGame } from '../src/services/gameQuery.js';
import { advanceMonitoring, emptySnapshot } from '../src/services/gameMonitoringState.js';
import * as monitoringState from '../src/services/gameMonitoringState.js';
import { validateTemplate, templateHash, CS16_TEMPLATE } from '../src/templates/schema.js';
import { migration } from '../src/database/migrations/0006_game_monitoring.js';
import { loadWithMocks } from './loadWithMocks.js';
import type { GameMonitoringConfig } from '../src/templates/types.js';

const config: GameMonitoringConfig = { enabled: true, protocol: 'a2s', queryPort: 27015, intervalSeconds: 30, startupGraceSeconds: 90, failureThreshold: 3 };
const info = { name: 'Test server', map: 'de_dust2', players: 0, maxPlayers: 16, bots: 0 };
const prefix = Buffer.from([255, 255, 255, 255]);
const source = () => Buffer.concat([prefix, Buffer.from([0x49, 17]), Buffer.from('Test server\0de_dust2\0cstrike\0Counter-Strike\0'), Buffer.from([10, 0, 0, 16, 0, 100, 108, 0, 1]), Buffer.from('1.1.2.7\0')]);

test('A2S parser reads Source and legacy GoldSrc and rejects truncated packets', () => {
    assert.deepEqual(parseGameInfo(source()), info);
    const legacy = Buffer.concat([prefix, Buffer.from([0x6d]), Buffer.from('127.0.0.1:27015\0Test server\0de_dust2\0cstrike\0Counter-Strike\0'), Buffer.from([0, 16, 48, 100, 108, 0, 0, 1, 0])]);
    assert.deepEqual(parseGameInfo(legacy), info);
    assert.throws(() => parseGameInfo(source().subarray(0, 30)), /Invalid A2S string/);
    assert.throws(() => parseGameInfo(Buffer.alloc(4)), /Invalid A2S/);
});

async function udp(t: any, respond: (data: Buffer, reply: (data: Buffer) => void) => void) {
    const socket = createSocket('udp4');
    t.after(() => socket.close());
    socket.on('message', (data, remote) => respond(data, value => socket.send(value, remote.port, remote.address)));
    await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve));
    return socket.address().port;
}
test('real UDP query completes the challenge handshake and closes after timeout', async t => {
    let count = 0;
    const challenge = Buffer.from([1, 2, 3, 4]);
    const port = await udp(t, (data, reply) => {
        count++;
        assert.equal(data[4], 0x54);
        if (count === 1) reply(Buffer.concat([prefix, Buffer.from([0x41]), challenge]));
        else { assert.deepEqual(data.subarray(-4), challenge); reply(source()); }
    });
    const result = await queryGame('127.0.0.1', port, 500);
    assert.deepEqual(result.info, info); assert.equal(count, 2);
    const silent = await udp(t, () => {});
    await assert.rejects(queryGame('127.0.0.1', silent, 20), /timed out/);
});
test('query assembles out-of-order Source split packets and limits challenge loops', async t => {
    const packet = source();
    const port = await udp(t, (_, reply) => {
        for (const index of [1, 0]) {
            const header = Buffer.alloc(12); header.writeInt32LE(-2); header.writeUInt32LE(42, 4); header[8] = 2; header[9] = index; header.writeUInt16LE(1248, 10);
            reply(Buffer.concat([header, index === 0 ? packet.subarray(0, 25) : packet.subarray(25)]));
        }
    });
    assert.deepEqual((await queryGame('127.0.0.1', port)).info, info);
    const looping = await udp(t, (_, reply) => reply(Buffer.concat([prefix, Buffer.from([0x41, 1, 2, 3, 4])])));
    await assert.rejects(queryGame('127.0.0.1', looping), /Invalid A2S challenge/);
});
test('GoldSrc split packets accept a short final fragment', async t => {
    const packet = source();
    const port = await udp(t, (_, reply) => {
        for (const index of [1, 0]) {
            const header = Buffer.alloc(9); header.writeInt32LE(-2); header.writeUInt32LE(123, 4); header[8] = (index << 4) | 2;
            reply(Buffer.concat([header, index === 0 ? packet.subarray(0, -2) : packet.subarray(-2)]));
        }
    });
    assert.deepEqual((await queryGame('127.0.0.1', port)).info, info);
});
test('failure threshold produces one incident, then one recovery; zero players is valid', () => {
    let snapshot = emptySnapshot();
    const events: string[] = [];
    for (let i = 0; i < 5; i++) {
        const result = advanceMonitoring(snapshot, config, { state: 'result', now: 1000000 + i * 30000, runtimeKey: 'one', error: 'timeout' });
        snapshot = result.snapshot;
        if (result.event) events.push(result.event.message);
        assert.equal(snapshot.state, i < 2 ? 'degraded' : 'offline');
        assert.equal(snapshot.info, null);
    }
    assert.equal(events.length, 1);
    const recovered = advanceMonitoring(snapshot, config, { state: 'result', now: 1150000, runtimeKey: 'one', info, latencyMs: 5 });
    assert.match(recovered.event!.message, /recovered after 90 seconds/);
    assert.equal(recovered.snapshot.info!.players, 0);
    assert.equal(advanceMonitoring(recovered.snapshot, config, { state: 'result', now: 1180000, runtimeKey: 'one', info }).event, null);
});
test('startup, maintenance and observation gaps do not accumulate false game failures', () => {
    const failing = { ...emptySnapshot(), state: 'degraded' as const, failures: 2, checkedAt: new Date(1000000).toISOString(), runtimeKey: 'one' };
    assert.equal(advanceMonitoring(failing, config, { state: 'starting', now: 1030000, runtimeKey: 'two' }).snapshot.failures, 0);
    assert.equal(advanceMonitoring(failing, config, { state: 'maintenance', now: 1030000, runtimeKey: 'one' }).event, null);
    assert.equal(advanceMonitoring(failing, config, { state: 'unavailable', now: 1030000, runtimeKey: 'one' }).snapshot.state, 'unavailable');
    assert.equal(advanceMonitoring(failing, config, { state: 'result', now: 1400000, runtimeKey: 'one', error: 'timeout' }).snapshot.failures, 1);
    assert.equal(advanceMonitoring(failing, config, { state: 'result', now: 1030000, runtimeKey: 'two', error: 'timeout' }).snapshot.failures, 1);
});
test('template monitoring references UDP keys and leaves old snapshot hashes unchanged', () => {
    const { monitoring: _profile, ...legacy } = CS16_TEMPLATE;
    const old = validateTemplate(legacy);
    assert.equal('monitoring' in old, false);
    assert.equal(templateHash(old), templateHash(validateTemplate(old)));
    assert.deepEqual(validateTemplate({ ...legacy, monitoring: { protocol: 'a2s', queryPort: 'game' } }).monitoring, { protocol: 'a2s', queryPort: 'game' });
    assert.throws(() => validateTemplate({ ...legacy, monitoring: { protocol: 'a2s', queryPort: 'missing' } }), /declared UDP/);
    assert.throws(() => validateTemplate({ ...legacy, ports: legacy.ports.map(p => ({ ...p, protocol: 'tcp' })), monitoring: { protocol: 'a2s', queryPort: 'game' } }), /declared UDP/);
});

test('SQLite monitoring survives reopening; obsolete observations cannot overwrite settings; deletion cascades', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'gp-monitor-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
    let db = new DatabaseSync(join(directory, 'db.sqlite'));
    t.after(() => db.close());
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE game_servers (id INTEGER PRIMARY KEY); INSERT INTO game_servers VALUES(7)');
    await migration.up({ exec: async (sql: string) => db.exec(sql) } as any);
    const adapter = {
        get: async (sql: string, args: any[]) => db.prepare(sql).get(...args),
        run: async (sql: string, args: any[]) => db.prepare(sql).run(...args),
    };
    const { GameMonitoringRepository } = loadWithMocks('../src/database/repositories/gameMonitoringRepository.ts', { './base.js': { BaseRepository: class { async ensureDb() { return adapter; } } } });
    const repo = new GameMonitoringRepository();
    const first = await repo.ensure(7, config, emptySnapshot());
    const snapshot = { ...emptySnapshot(), state: 'offline', incidentStartedAt: new Date().toISOString() };
    assert.equal(await repo.observe(7, first.revision, snapshot), true);
    db.close(); db = new DatabaseSync(join(directory, 'db.sqlite')); db.exec('PRAGMA foreign_keys=ON');
    assert.equal((await repo.get(7)).snapshot.incidentStartedAt, snapshot.incidentStartedAt);
    await repo.configure(7, { ...config, enabled: false }, emptySnapshot());
    assert.equal(await repo.observe(7, first.revision, snapshot), false);
    assert.equal((await repo.get(7)).config.enabled, false);
    db.exec('DELETE FROM game_servers WHERE id=7');
    assert.equal(await repo.get(7), null);
});

function workerFixture(total = 1) {
    const servers = new Map(Array.from({ length: total }, (_, i) => [i + 1, { id: i + 1, status: 'running', desired_state: 'running', docker_container_id: `container-${i + 1}`, ports_json: JSON.stringify({ tcp: [], udp: [{ container: 28015, host: 30001, label: 'Game' }] }), provider_metadata_json: '{}' }]));
    const records = new Map<number, any>(Array.from(servers.keys(), id => [id, { config: { ...config, queryPort: 28015 }, snapshot: emptySnapshot(), revision: 1 }]));
    const observed: number[] = [], queries: Array<{ host: string; port: number }> = [];
    const maintenance = new Set<number>();
    let query = async () => ({ info, latencyMs: 5 });
    let inspect = async (id: string) => ({ Id: id, State: { Running: true, StartedAt: new Date(0).toISOString() }, Config: { Labels: {} }, NetworkSettings: { Networks: { games: { IPAddress: '172.23.0.7' } } } });
    let tick: (() => void) | null = null;
    const service = loadWithMocks('../src/services/gameMonitoring.ts', {
        '../realtime/bus.js': { bus: { emit() {} } },
        dockerode: class { getContainer(id: string) { return { inspect: () => inspect(id) }; } },
        '../config.js': { getConfig: () => ({ dockerSocket: '/not-used', gamesNetwork: 'games' }) },
        '../database/index.js': { serverRepository: { listAll: async () => [...servers.values()], findById: async (id: number) => servers.get(id) }, actionsRepository: { create: async () => {} } },
        '../database/repositories/gameMonitoringRepository.js': { gameMonitoringRepository: {
            ensure: async (id: number) => structuredClone(records.get(id)),
            get: async (id: number) => records.get(id),
            observe: async (id: number, revision: number, snapshot: any) => { if (records.get(id).revision !== revision) return false; records.get(id).snapshot = snapshot; observed.push(id); return true; },
        } },
        '../providers/runtimeConfig.js': { parseStoredPorts: (s: any) => JSON.parse(s.ports_json) },
        '../utils/docker/ownership.js': { ownsContainer: () => true },
        '../utils/logger.js': { logError: (context: string, error: unknown) => { throw new Error(`${context}: ${error}`); } },
        './nativeOperationLock.js': { nativeOperationRunning: (id: number) => maintenance.has(id) },
        './panelMaintenance.js': { isPanelMaintenance: () => false },
        './gameMonitoringState.js': monitoringState,
        './gameQuery.js': { queryGame: async (host: string, port: number) => { queries.push({ host, port }); return query(); } },
    }, { setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval: () => { tick = null; } });
    return { service, servers, records, observed, queries, maintenance, tick: () => tick?.(), onQuery: (fn: typeof query) => { query = fn; }, onInspect: (fn: typeof inspect) => { inspect = fn; } };
}
async function until(fn: () => boolean) {
    for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
    assert.fail('Monitoring did not reach the expected state');
}
test('node worker queries the actual container IP / allocated query port without a browser', async t => {
    const f = workerFixture(); const worker = f.service.startGameMonitoringWorker(); t.after(() => worker.stop());
    await until(() => f.observed.length === 1);
    assert.deepEqual(f.queries, [{ host: '172.23.0.7', port: 28015 }]);
    assert.equal(f.records.get(1).snapshot.state, 'online');
    const summary = f.service.monitoringSummary(f.records.get(1), Date.now() + 400000);
    assert.equal(summary.state, 'stale'); assert.equal(summary.info, null);
});
test('worker caps concurrency, admits other servers on later ticks, and ignores results after shutdown', async () => {
    const f = workerFixture(10);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.onQuery(async () => { await gate; return { info, latencyMs: 5 }; });
    const worker = f.service.startGameMonitoringWorker();
    await until(() => f.queries.length === 8);
    f.tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.queries.length, 8);
    release(); await until(() => f.observed.length === 8);
    f.tick(); await until(() => f.observed.length === 10);
    worker.stop();
    const stopped = workerFixture(); let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    stopped.onQuery(async () => { await wait; return { info, latencyMs: 1 }; });
    const other = stopped.service.startGameMonitoringWorker(); await until(() => stopped.queries.length === 1);
    other.stop(); finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped.observed.length, 0);
});
test('maintenance suppresses queries; Docker errors remain unknown; disabled configuration blocks in-flight results', async t => {
    const f = workerFixture(); f.maintenance.add(1);
    const worker = f.service.startGameMonitoringWorker(); t.after(() => worker.stop());
    await until(() => f.observed.length === 1);
    assert.equal(f.queries.length, 0); assert.equal(f.records.get(1).snapshot.state, 'maintenance');
    f.maintenance.clear(); f.onInspect(async () => { throw new Error('daemon unavailable'); });
    assert.equal((await f.service.observeGame(f.servers.get(1), f.records.get(1))).state, 'unavailable');
    const second = workerFixture(); let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    second.onQuery(async () => { await gate; return { info, latencyMs: 1 }; });
    const other = second.service.startGameMonitoringWorker(); t.after(() => other.stop());
    await until(() => second.queries.length === 1);
    second.records.get(1).revision++; second.records.get(1).config.enabled = false;
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(second.observed.length, 0);
});
test('configuration rejects non-allocated ports and limits, defaults leave existing snapshots opt-in', () => {
    const f = workerFixture(), server = f.servers.get(1);
    assert.equal(f.service.monitoringDefaults(server).enabled, false);
    const valid = { ...config, queryPort: 28015 };
    assert.equal(f.service.validateMonitoringConfig(valid, server).queryPort, 28015);
    assert.throws(() => f.service.validateMonitoringConfig({ ...valid, queryPort: 27015 }, server), /allocated UDP/);
    assert.throws(() => f.service.validateMonitoringConfig({ ...valid, intervalSeconds: 0 }, server), /10 to 300/);
    assert.throws(() => f.service.validateMonitoringConfig({ ...valid, enabled: 'true' }, server));
    const inherited = { ...server, provider_metadata_json: JSON.stringify({ template: { document: { monitoring: { protocol: 'a2s', queryPort: 'query' }, ports: [{ key: 'query', protocol: 'udp', container: 28015 }] } } }) };
    assert.equal(f.service.monitoringDefaults(inherited).enabled, true);
});
