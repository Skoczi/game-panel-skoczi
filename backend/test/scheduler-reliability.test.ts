import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWithMocks } from './loadWithMocks.js';
import * as cron from '../src/utils/cron.js';
import * as time from '../src/utils/time.js';

const past = '2020-01-01T00:00:00.000Z';
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
async function until(predicate: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 100; i++) {
        if (await predicate()) return;
        await new Promise<void>(done => setImmediate(done));
    }
    assert.fail('Expected state was not reached');
}
function fixture(filename = ':memory:') {
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys=OFF');
    const init = readFileSync(new URL('../src/database/init.ts', import.meta.url), 'utf8');
    db.exec(init.match(/CREATE TABLE IF NOT EXISTS server_scheduled_tasks \([\s\S]*?\n      \)/)![0]);
    const adapter = {
        all: async (sql: string, args: any[] = []) => db.prepare(sql).all(...args),
        get: async (sql: string, args: any[] = []) => db.prepare(sql).get(...args),
        run: async (sql: string, args: any[] = []) => {
            const result = db.prepare(sql).run(...args);
            return { changes: Number(result.changes), lastID: Number(result.lastInsertRowid) };
        },
    };
    const { ScheduledTaskRepository } = loadWithMocks('../src/database/repositories/scheduledTaskRepository.ts', {
        './base.js': { BaseRepository: class { async ensureDb() { return adapter; } } },
        '../../utils/time.js': { nowIso: () => new Date().toISOString() },
    });
    const repo = new ScheduledTaskRepository();
    const calls: Array<{ command: string; container: string }> = [];
    const actions: string[] = [];
    const servers = new Map<number, any>();
    const busy = new Set<number>();
    let commandHook = async (_command: string) => {};
    let restartHook = async () => ({ wasRunning: true });
    let tick: (() => void) | undefined;
    const server = (id: number) => servers.get(id) ?? { id, docker_container_id: `container-${id}`, provider_metadata_json: '{}' };
    const scheduler = loadWithMocks('../src/services/scheduledTasks.ts', {
        './serverReconfiguration.js': { applyPendingServerConfiguration: () => restartHook() },
        './panelMaintenance.js': { isPanelMaintenance: () => false },
        './nativeBackups.js': { nativeServerTemplate: () => null },
        '../database/index.js': { serverRepository: { findById: async (id: number) => server(id) }, scheduledTaskRepository: repo,
            actionsRepository: { create: async (_id: number, _level: string, message: string) => { actions.push(message); } } },
        './nativeOperationLock.js': { enterServerMutation: (id: number) => {
            if (busy.has(id)) throw Object.assign(new Error('Busy'), { statusCode: 409 });
            busy.add(id); return () => busy.delete(id);
        } },
        '../providers/serverMetadata.js': {}, '../utils/cron.js': cron,
        '../utils/json.js': { parseJsonObject: JSON.parse }, '../utils/logger.js': { logError: () => {} },
        '../utils/time.js': time,
        '../utils/docker.js': { checkContainerStatus: async () => 'running' }, './serverBackups.js': {},
        './gameConsole.js': { sendGameConsoleCommand: async (current: any, command: string) => {
            calls.push({ command, container: current.docker_container_id }); await commandHook(command); return { ok: true };
        } }, './serverTransitions.js': { clearServerTransition: () => {}, reconcileServerStatus: async () => {} }, './ovhcloudLifecycle.js': {},
    }, { setTimeout, setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval: () => { tick = undefined; } });
    const add = (id: number, payload: any = { command: `task-${id}` }, type = 'game_command') => repo.create({ serverId: id, type, payload, enabled: true, schedule: '* * * * *', nextRunAt: past });
    return { db, repo, scheduler, calls, actions, servers, busy, add,
        onCommand: (fn: typeof commandHook) => { commandHook = fn; }, onRestart: (fn: typeof restartHook) => { restartHook = fn; },
        tick: () => tick?.(), close: () => db.close() };
}

test('pending task does not block a later tick on another server; same-server tasks queue', async t => {
    const f = fixture(); t.after(f.close);
    const first = await f.add(1); const second = await f.add(1, { command: 'second' });
    const gate = deferred(); f.onCommand(async command => { if (command === 'task-1') await gate.promise; });
    const initial = f.scheduler.runDueScheduledTasks();
    await until(() => f.calls.length === 1);
    await f.add(2); await f.scheduler.runDueScheduledTasks();
    assert.deepEqual(f.calls.map(c => c.command), ['task-1', 'task-2']);
    assert.equal((await f.repo.findById(second.id)).last_status, null);
    gate.resolve(); await initial; await f.scheduler.runDueScheduledTasks();
    assert.deepEqual(f.calls.map(c => c.command), ['task-1', 'task-2', 'second']);
    assert.equal((await f.repo.findById(first.id)).last_status, 'success');
    assert.equal((await f.repo.findById(second.id)).last_status, 'success');
});

test('dispatcher bounds concurrent tasks and leaves excess tasks due', async t => {
    const f = fixture(); t.after(f.close);
    for (let id = 1; id <= 21; id++) await f.add(id);
    const gate = deferred(); f.onCommand(() => gate.promise);
    const initial = f.scheduler.runDueScheduledTasks(); await until(() => f.calls.length === 20);
    await f.scheduler.runDueScheduledTasks(); assert.equal(f.calls.length, 20);
    gate.resolve(); await initial; await f.scheduler.runDueScheduledTasks();
    assert.equal(f.calls.length, 21);
});

for (const failure of [false, true]) test(`cleanup resolves the replacement container after restart (restart failure=${failure})`, async t => {
    const f = fixture(); t.after(f.close);
    await f.add(1, { post: [{ type: 'game_command', command: 'post' }], cleanup: [{ type: 'game_command', command: 'cleanup' }] }, 'restart');
    f.onRestart(async () => {
        f.servers.set(1, { id: 1, docker_container_id: 'replacement' });
        if (failure) throw new Error('Restart failed after recreation');
        return { wasRunning: true };
    });
    await f.scheduler.runDueScheduledTasks();
    assert.deepEqual(f.calls, (failure ? ['cleanup'] : ['post', 'cleanup']).map(command => ({ command, container: 'replacement' })));
    assert.equal((await f.repo.findById(1)).last_status, failure ? 'failed' : 'success');
});

test('busy server retains its due task instead of failing it or consuming the schedule', async t => {
    const f = fixture(); t.after(f.close);
    const task = await f.add(1); await f.add(2); f.busy.add(1);
    await f.scheduler.runDueScheduledTasks();
    assert.deepEqual(f.calls.map(c => c.command), ['task-2']);
    const queued = await f.repo.findById(task.id);
    assert.equal(queued.last_status, null); assert.equal(queued.next_run_at, past); assert.equal(queued.locked_at, null);
    f.busy.delete(1); await f.scheduler.runDueScheduledTasks();
    assert.equal((await f.repo.findById(task.id)).last_status, 'success');
});

test('locked tasks cannot be edited, disabled or deleted; claim checks current due/enabled state', async t => {
    const f = fixture(); t.after(f.close);
    const task = await f.add(1); const at = new Date().toISOString();
    assert.equal(await f.repo.lock(task.id, at), true);
    await assert.rejects(f.repo.update(task.id, { enabled: false, lockedAt: null }), { statusCode: 409 });
    await assert.rejects(f.repo.delete(task.id), { statusCode: 409 });
    assert.equal((await f.repo.findById(task.id)).locked_at, at);
    assert.equal(await f.repo.lock(task.id, at), false);
    await f.repo.finish(task.id, { nextRunAt: past, lastStatus: 'success' });
    await f.repo.update(task.id, { enabled: false }); assert.equal(await f.repo.lock(task.id, at), false);
    await f.repo.update(task.id, { enabled: true, nextRunAt: '2099-01-01T00:00:00.000Z' }); assert.equal(await f.repo.lock(task.id, at), false);
});

test('process recovery durably pauses interrupted tasks, preserves other tasks, and requires explicit re-enable', async t => {
    const root = mkdtempSync(join(tmpdir(), 'gp-scheduler-recovery-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const filename = join(root, 'tasks.db'); const before = fixture(filename);
    const interrupted = await before.add(1); await before.add(2);
    await before.repo.lock(interrupted.id, new Date().toISOString()); before.close();
    const f = fixture(filename); t.after(f.close);
    const runner = f.scheduler.startScheduledTaskRunner(); t.after(() => runner.stop());
    await until(async () => (await f.repo.findById(2)).last_status === 'success');
    const recovered = await f.repo.findById(interrupted.id);
    assert.equal(recovered.last_status, 'interrupted'); assert.equal(recovered.enabled, 0); assert.equal(recovered.next_run_at, null);
    assert.match(recovered.last_error, /cleanup is not confirmed/);
    assert.deepEqual(f.calls.map(c => c.command), ['task-2']);
    assert(f.actions.some(a => a.includes('interrupted; schedule disabled')));
    assert.equal((await f.repo.recoverInterrupted()).length, 0);
    await f.scheduler.updateScheduledTask(1, interrupted.id, { enabled: true });
    const resumed = await f.repo.findById(interrupted.id);
    assert.equal(resumed.enabled, 1); assert(Date.parse(resumed.next_run_at) > Date.now());
    await f.scheduler.runDueScheduledTasks(); assert.equal(f.calls.length, 1, 're-enable schedules a future run, not a replay');
});

test('dispatch waits for recovery and stays stopped if recovery fails', async t => {
    const f = fixture(); t.after(f.close); await f.add(1);
    const gate = deferred(); f.repo.recoverInterrupted = async () => { await gate.promise; throw new Error('DB unavailable'); };
    const runner = f.scheduler.startScheduledTaskRunner(); t.after(() => runner.stop());
    const pending = f.scheduler.runDueScheduledTasks();
    await new Promise<void>(done => setImmediate(done)); assert.equal(f.calls.length, 0);
    gate.resolve(); await assert.rejects(pending, /DB unavailable/);
    await assert.rejects(f.scheduler.runDueScheduledTasks(), /DB unavailable/); assert.equal(f.calls.length, 0);
});

test('recovery does not interrupt executions still owned by this process', async t => {
    const f = fixture(); t.after(f.close);
    const task = await f.add(1); await f.repo.lock(task.id, new Date().toISOString());
    assert.equal((await f.repo.recoverInterrupted([task.id])).length, 0);
    assert.equal((await f.repo.findById(task.id)).enabled, 1);
});

test('stopping the runner during startup recovery does not dispatch tasks afterwards', async t => {
    const f = fixture(); t.after(f.close); await f.add(1);
    const gate = deferred(); const recover = f.repo.recoverInterrupted.bind(f.repo);
    f.repo.recoverInterrupted = async () => { await gate.promise; return recover(); };
    const runner = f.scheduler.startScheduledTaskRunner();
    const pending = f.scheduler.runDueScheduledTasks(); runner.stop(); gate.resolve(); await pending;
    assert.equal(f.calls.length, 0);
});

test('editing configuration does not overwrite a run result committed after the initial read', async t => {
    const f = fixture(); t.after(f.close); const task = await f.add(1);
    const read = f.repo.findById.bind(f.repo); let first = true;
    f.repo.findById = async (id: number) => {
        const snapshot = await read(id);
        if (first) {
            first = false;
            f.db.prepare("UPDATE server_scheduled_tasks SET last_status='success', last_run_at=? WHERE id=?").run('2026-09-22T12:00:00Z', id);
        }
        return snapshot;
    };
    await f.repo.update(task.id, { payload: { command: 'new command' } });
    assert.equal((await read(task.id)).last_status, 'success');
});
