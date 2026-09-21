import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { publicApi, publicApiErrorHandler } from '../src/routes/publicApi.js';
import { ApiOperationStore } from '../src/services/apiOperations.js';
import { requestContext } from '../src/middleware/requestContext.js';

test('backup HTTP admission replays without dispatch, reports uncertain outcomes and rechecks ownership and runtime', async () => {
    const db = new DatabaseSync(':memory:');
    const adapter = { exec: async (sql: string) => db.exec(sql),
        run: async (sql: string, ...params: any[]) => db.prepare(sql).run(...params),
        get: async (sql: string, ...params: any[]) => db.prepare(sql).get(...params) };
    const operations = new ApiOperationStore(adapter as any); await operations.initialize();
    const serverId = '11111111-1111-4111-8111-111111111111';
    const row = { id: serverId, node_id: 'local', runtime_id: 7, runtime_key: 'original', missing: 0 };
    let ownerId = 1, permission = true, failed = false, dispatches = 0;
    const token = { id: 'token', ownerId: 1, scopes: ['backups.create', 'operations.read'], serverIds: [serverId], expiresAt: Date.now() + 60000, revokedAt: null };
    const app = express(); app.use(requestContext); app.use(express.json());
    app.use('/api/v1', publicApi({ store: () => ({ authenticate: async () => ({ ...token, ownerId }), markUsed: async () => {} }) as any,
        owner: async () => ({ userId: ownerId, isRoot: false, enabled: true }), servers: async () => [row] as any,
        permissions: async () => permission ? ['backups.create'] : [],
        operations: { store: () => operations, normalizeName: value => { if (typeof value !== 'string') throw new Error('name'); return value; },
            start: async () => { dispatches++; if (failed) throw new Error('Response lost'); return 'job'; },
            readJob: async () => ({ status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }) },
    }));
    app.use('/api/v1', publicApiErrorHandler);
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
    const headers = { authorization: 'Bearer gpp_' + 'a'.repeat(43), 'content-type': 'application/json' };
    const post = (key: string, name: unknown = 'Before update') => fetch(base+`/servers/${serverId}/backups`, {
        method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify({ name }) });
    const get = (location: string) => fetch(base.replace('/api/v1', '') + location, { headers });
    try {
        const malformed = await fetch(base+`/servers/${serverId}/backups`, { method: 'POST', headers, body: '{not json' });
        assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'invalid_request');
        assert.equal((await post('short')).status, 400); assert.equal(dispatches, 0);
        assert.equal((await post('valid_key_1234567', 123)).status, 400); assert.equal(dispatches, 0);
        const first = await post('valid_key_1234567'); assert.equal(first.status, 202);
        const location = first.headers.get('location')!; await first.body?.cancel();
        const replay = await post('valid_key_1234567'); assert.equal(replay.status, 202);
        assert.equal(replay.headers.get('location'), location); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
        assert.equal(dispatches, 1);
        assert.equal((await post('valid_key_1234567', 'Different')).status, 409); assert.equal(dispatches, 1);
        await operations.initialize();
        assert.equal((await post('valid_key_1234567')).status, 202); assert.equal(dispatches, 1);
        const status = await (await get(location)).json(); assert.equal(status.data.status, 'completed');
        assert(!JSON.stringify(status).includes('runtime_key')); assert(!JSON.stringify(status).includes('job'));
        permission = false; assert.equal((await get(location)).status, 404);
        assert.equal((await post('valid_key_1234567')).status, 404); assert.equal(dispatches, 1);
        permission = true; ownerId = 2; assert.equal((await get(location)).status, 404);
        ownerId = 1; row.runtime_key = 'replacement'; assert.equal((await get(location)).status, 409);
        row.runtime_key = 'original'; failed = true;
        const uncertain = await post('unknown_key_123456'); assert.equal(uncertain.status, 409);
        assert.equal((await uncertain.json()).error.code, 'outcome_uncertain');
        assert.equal(dispatches, 2);
        assert.equal((await post('unknown_key_123456')).status, 409); assert.equal(dispatches, 2);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
