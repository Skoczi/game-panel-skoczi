import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { apiTokenManagement } from '../src/routes/apiTokenManagement.js';

test('token management checks every selected server, never trusts supplied owner and hides secrets on listing', async () => {
    const allowed = '11111111-1111-4111-8111-111111111111';
    const denied = '22222222-2222-4222-8222-222222222222';
    let created = 0;
    const store = {
        create: async (owner: number) => { assert.equal(owner, 7); created++; return { secret: 'one-time-secret', token: { id: 'issued' } }; },
        list: async (owner: number) => { assert.equal(owner, 7); return [{ id: 'issued' }]; },
        revoke: async (owner: number, id: string) => owner === 7 && id === 'issued',
    };
    const app = express(); app.use(express.json());
    app.use((req: any, _res, next) => { if (req.headers.authorization === 'session') req.user = { userId: 7 }; next(); });
    app.use('/tokens', apiTokenManagement({ store: () => store as any,
        permissions: async id => id === allowed ? ['backups.read'] : null }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as any).port}/tokens`;
    const body = { name: 'monitor', scopes: ['backups.read'], serverIds: [allowed], expiresAt: Date.now() + 60000, ownerId: 999 };
    const post = (data: any, authorization = 'session') => fetch(url, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    try {
        assert.equal((await post(body, 'gpp_invalid')).status, 401);
        assert.equal((await post({ ...body, serverIds: [allowed, denied] })).status, 403);
        assert.equal((await post({ ...body, scopes: ['backups.create'] })).status, 403);
        assert.equal((await post({ ...body, scopes: ['*'] })).status, 400);
        assert.equal(created, 0);
        const createdResponse = await post(body);
        assert.equal(createdResponse.status, 201);
        assert.equal(createdResponse.headers.get('cache-control'), 'no-store');
        assert.equal((await createdResponse.json()).secret, 'one-time-secret');
        const listing = await fetch(url, { headers: { authorization: 'session' } });
        assert(!JSON.stringify(await listing.json()).includes('secret'));
        assert.equal((await fetch(url+'/other', { method: 'DELETE', headers: { authorization: 'session' } })).status, 404);
        assert.equal((await fetch(url+'/issued', { method: 'DELETE', headers: { authorization: 'session' } })).status, 204);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
