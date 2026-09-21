import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { loadWithMocks } from './loadWithMocks.js';
import { TemplateStore } from '../src/templates/store.js';
import * as schema from '../src/templates/schema.js';
import * as tickets from '../src/templates/tickets.js';

test('template HTTP routes enforce root, draft publication, node isolation and secret-free export', async () => {
    const native = new DatabaseSync(':memory:');
    const db = { exec: async (s: string) => native.exec(s), run: async (s: string, ...a: any[]) => native.prepare(s).run(...a), get: async (s: string, ...a: any[]) => native.prepare(s).get(...a), all: async (s: string, ...a: any[]) => native.prepare(s).all(...a) };
    const { rootOnly } = loadWithMocks('../src/middleware/auth.ts', { '../agent/identity.js': {}, '../utils/auth.js': {}, '../database/index.js': {}, '../utils/ids.js': {}, '../utils/logger.js': {}, '../permissions.js': {} });
    const key = 'test-only-template-node-key';
    const module = loadWithMocks('../src/templates/routes.ts', {
        express, '../middleware/auth.js': { rootOnly }, '../database/init.js': { getDatabase: async () => db },
        '../config.js': { getConfig: () => ({ jwtSecret: 'local-test-only-key' }) },
        '../nodes/control.js': { nodes: () => ({ get: async (id: string) => id === 'remote' ? { enabled: true, key_encrypted: 'encrypted' } : undefined, key: () => key }) },
        './store.js': { TemplateStore }, './schema.js': schema, './tickets.js': tickets,
    });
    await module.initializeTemplates();
    const app = express(); app.use(express.json());
    app.use((req: any, res, next) => { if (!req.headers['x-test-role']) { res.sendStatus(401); return; } req.user = { isRoot: req.headers['x-test-role'] === 'root', username: 'admin' }; next(); });
    app.use('/api/game-templates', module.templateRoutes);
    const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/game-templates`;
    const request = (path: string, body?: unknown, role = 'root') => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-test-role': role, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try {
        assert.equal((await fetch(base)).status, 401);
        for (const [path, body] of [['', undefined], ['', { document: schema.CS16_TEMPLATE }], ['/builtin-cs16/1/status', { status: 'published' }], ['/builtin-cs16/1/prepare', { nodeId: 'local' }], ['/builtin-cs16/1/export', undefined]] as const) assert.equal((await request(path, body, 'user')).status, 403);
        assert.equal((await request('/builtin-cs16/1/prepare', { nodeId: 'local' })).status, 409);
        assert.equal((await request('/builtin-cs16/1/status', { status: 'published' })).status, 200);
        assert.equal((await request('/builtin-cs16/1/prepare', { nodeId: 'unknown' })).status, 409);
        const prepared = await request('/builtin-cs16/1/prepare', { nodeId: 'remote' }); assert.equal(prepared.headers.get('cache-control'), 'no-store');
        const { ticket } = await prepared.json() as any;
        assert.equal(tickets.readTemplateTicket(ticket, key, 'remote').document.runtime.image, schema.CS16_TEMPLATE.runtime.image);
        assert.throws(() => tickets.readTemplateTicket(ticket, key, 'local'));
        const exported = await (await request('/builtin-cs16/1/export')).json(); assert.deepEqual(exported, schema.CS16_TEMPLATE);
        await request('/builtin-cs16/1/status', { status: 'disabled' }); assert.equal((await request('/builtin-cs16/1/prepare', { nodeId: 'remote' })).status, 409);
        assert.equal((await request('', { document: { ...schema.CS16_TEMPLATE, scripts: {} } })).status, 400);
        assert.equal((await fetch(base + '/builtin-cs16', { method: 'DELETE', headers: { 'x-test-role': 'user' } })).status, 403);
        assert.equal((await fetch(base + '/builtin-cs16', { method: 'DELETE', headers: { 'x-test-role': 'root' } })).status, 200);
        assert.equal((await request('/builtin-cs16/1/prepare', { nodeId: 'local' })).status, 404);
        assert.equal((await request('/builtin-cs16/1/export')).status, 404);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); native.close(); }
});
