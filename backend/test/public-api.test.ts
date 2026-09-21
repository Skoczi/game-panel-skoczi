import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { publicApi } from '../src/routes/publicApi.js';
import { requestContext } from '../src/middleware/requestContext.js';

test('public API paginates scoped inventory, rechecks account and membership, and never returns runtime secrets', async () => {
    const ids = [1, 2, 3].map(n => `${n}1111111-1111-4111-8111-111111111111`);
    const token = { id: 'token', ownerId: 1, scopes: ['servers.read'], serverIds: ids.slice(0, 2),
        expiresAt: Date.now() + 60000, revokedAt: null };
    const secret = 'gpp_' + 'a'.repeat(43);
    let enabled = true, member = true, revoked = false, used = 0;
    let resourceCalls = 0;
    let backupPermission = false, backupCalls = 0;
    const app = express(); app.use(requestContext);
    app.use('/api/v1', publicApi({
        store: () => ({ authenticate: async (value: string) => value === secret && !revoked ? token : null,
            markUsed: async () => { used++; } }) as any,
        owner: async () => ({ userId: 1, isRoot: false, enabled }),
        servers: async () => ids.map((id, index) => ({ id, server_number: index + 1, name: 'Server',
            provider: 'native', status: 'running', observed_at: 1000000, missing: 0,
            runtime_id: 99, runtime_key: 'private-identity', node_id: 'private-node',
            env: { PASSWORD: 'secret' } })) as any,
        permissions: async () => member ? (backupPermission ? ['backups.read'] : []) : null,
        resources: async () => { resourceCalls++; return { observedAt: null, resources: null }; },
        backups: async () => { backupCalls++; return [{ name: 'a.tar.gz' }, { name: 'b.tar.gz' }]; },
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
    const get = (path: string, bearer = secret) => fetch(base + path, { headers: { authorization: `Bearer ${bearer}` } });
    try {
        assert.equal((await get('/servers', 'session-jwt')).status, 401);
        const response = await get('/servers?limit=1');
        const page = await response.json();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(page.requestId, response.headers.get('x-request-id'));
        assert.equal(page.data.length, 1); assert.equal(page.nextCursor, ids[0]);
        assert.deepEqual(Object.keys(page.data[0]).sort(), ['id', 'name', 'number', 'observedAt', 'provider', 'status']);
        assert.equal(page.data[0].observedAt, '1970-01-01T00:16:40.000Z');
        const next = await (await get('/servers?limit=1&after='+page.nextCursor)).json();
        assert.equal(next.data[0].id, ids[1]); assert.equal(next.nextCursor, null);
        assert.equal((await get('/servers/'+ids[2])).status, 404);
        assert.equal((await get('/servers/'+ids[0])).status, 200);
        assert.equal((await get('/servers?limit=1000')).status, 400);
        assert.equal((await get('/servers/'+ids[0]+'/resources')).status, 403);
        assert.equal(resourceCalls, 0);
        token.scopes.push('resources.read');
        assert.equal((await get('/servers/'+ids[2]+'/resources')).status, 404);
        assert.equal(resourceCalls, 0);
        assert.equal((await get('/servers/'+ids[0]+'/resources')).status, 200);
        assert.equal(resourceCalls, 1);
        assert.equal((await get('/servers/'+ids[0]+'/backups')).status, 403);
        token.scopes.push('backups.read');
        assert.equal((await get('/servers/'+ids[0]+'/backups')).status, 404);
        assert.equal(backupCalls, 0);
        backupPermission = true;
        const backups = await (await get('/servers/'+ids[0]+'/backups?limit=1')).json();
        assert.deepEqual(backups.data, [{ name: 'a.tar.gz' }]); assert.equal(backups.nextCursor, 'a.tar.gz');
        const backupPage = await (await get('/servers/'+ids[0]+'/backups?limit=1&after=a.tar.gz')).json();
        assert.deepEqual(backupPage.data, [{ name: 'b.tar.gz' }]); assert.equal(backupPage.nextCursor, null);
        member = false;
        assert.equal((await get('/servers/'+ids[0])).status, 404);
        assert.deepEqual((await (await get('/servers')).json()).data, []);
        enabled = false; assert.equal((await get('/servers')).status, 401);
        enabled = true; revoked = true; assert.equal((await get('/servers')).status, 401);
        assert(used > 0);
        revoked = false; member = true;
        let limited: Response | undefined;
        for (let i = 0; i < 125; i++) {
            const response = await get('/servers');
            if (response.status === 429) { limited = response; break; }
        }
        assert(limited); assert(Number(limited.headers.get('retry-after')) > 0);
        assert.equal((await limited.json()).error.code, 'rate_limited');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
