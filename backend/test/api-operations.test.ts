import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ApiOperationStore } from '../src/services/apiOperations.js';
test('API operation admission prevents duplicates and marks unfinished dispatch uncertain on restart', async () => {
    const db = new DatabaseSync(':memory:');
    const adapter = { exec: async (sql: string) => db.exec(sql),
        run: async (sql: string, ...params: any[]) => db.prepare(sql).run(...params),
        get: async (sql: string, ...params: any[]) => db.prepare(sql).get(...params) };
    const store = new ApiOperationStore(adapter as any);
    try {
        await store.initialize();
        const input = { tokenId: 'token', ownerId: 7, serverId: 'server', nodeId: 'node', runtimeId: 8,
            runtimeKey: 'runtime', key: 'unique_request_key_123', name: 'Before update' };
        const admissions = await Promise.all([store.admit(input), store.admit(input)]);
        assert.equal(admissions.filter(a => a.fresh).length, 1);
        assert.equal(admissions[0].operation.id, admissions[1].operation.id);
        const id = admissions[0].operation.id;
        assert((await store.admit({ ...input, name: 'Another backup' })).conflict);
        assert((await store.admit({ ...input, serverId: 'another' })).conflict);
        const restarted = new ApiOperationStore(adapter as any); await restarted.initialize();
        const replay = await restarted.admit(input);
        assert(!replay.fresh); assert.equal(replay.operation.state, 'uncertain');
        await assert.rejects(restarted.started(id, 'job'));
        const next = await restarted.admit({ ...input, key: 'another_request_key_123' });
        await restarted.started(next.operation.id, 'job');
        await restarted.initialize();
        assert.equal((await restarted.get(next.operation.id))?.state, 'started');
        assert.equal((await restarted.get(next.operation.id))?.job_id, 'job');
        assert.equal((await restarted.admit({ ...input, key: 'another_request_key_123' })).fresh, false);
        assert((await restarted.admit({ ...input, tokenId: 'other-token' })).fresh);
        await assert.rejects(restarted.admit({ ...input, key: 'short' }));
    } finally { db.close(); }
});
