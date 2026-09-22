import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadWithMocks } from './loadWithMocks.js';

test('concurrent status completions publish only one event using an atomic database update', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE TABLE game_servers(id INTEGER PRIMARY KEY,status TEXT,last_error TEXT,updated_at TEXT); INSERT INTO game_servers VALUES(7,'starting',NULL,NULL)");
    const events: any[] = [];
    const adapter = { run: async (sql: string, values: any[]) => db.prepare(sql).run(...values) };
    const module = loadWithMocks('../src/database/repositories/gameServerRepository.ts', {
        '../../realtime/bus.js': { bus: { emit: (...args: any[]) => events.push(args) } },
        '../../utils/time.js': { nowIso: () => '2026-09-21T13:00:00.000Z' },
        './base.js': { BaseRepository: class { async ensureDb() { return adapter; } } },
    });
    try {
        const repository = new module.GameServerRepository();
        await Promise.all([repository.updateStatusIfChanged(7, 'running'), repository.updateStatusIfChanged(7, 'running')]);
        assert.equal(events.length, 1);
        await Promise.all([repository.updateStatusIfChanged(7, 'stopped'), repository.updateStatusIfChanged(7, 'stopped')]);
        assert.equal(events.length, 2);
        assert.equal(db.prepare('SELECT status FROM game_servers WHERE id=7').get()!.status, 'stopped');
    } finally { db.close(); }
});

test('initial health poll waits for Docker start instead of reporting the previous stopped state', async () => {
    const statuses: string[] = [];
    const intervals: Array<() => void> = [];
    let containerStatus = 'exited';
    const module = loadWithMocks('../src/services/serverTransitions.ts', {
        '../database/index.js': { serverRepository: {
            findById: async () => ({ docker_container_id: 'container' }),
            updateStatus: async (_id: number, status: string) => statuses.push(status),
            updateStatusIfChanged: async (_id: number, status: string) => statuses.push(status),
        } },
        '../utils/docker.js': { inspectContainerRuntime: async () => ({ containerStatus, healthStatus: 'none' }) },
        '../utils/logger.js': { logError: () => {} },
    }, { setTimeout: () => 1, clearTimeout: () => {}, setInterval: (callback: () => void) => { intervals.push(callback); return 2; }, clearInterval: () => {} });
    await module.beginServerTransition(7, 'starting', { timeoutMs: 1000, timeoutBehavior: 'reconcile', pollDockerHealth: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(statuses, ['starting']);
    containerStatus = 'running';
    intervals[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(statuses, ['starting', 'running']);
});
