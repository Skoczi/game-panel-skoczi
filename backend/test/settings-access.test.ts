import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadWithMocks } from './loadWithMocks.js';

test('settings routes require root; appearance exposes no allocations', async () => {
    const { rootOnly } = loadWithMocks('../src/middleware/auth.ts', {
        '../utils/auth.js': {}, '../database/index.js': {}, '../utils/ids.js': {}, '../utils/logger.js': {}, '../permissions.js': {},
    });
    let saves = 0, assignmentReads = 0;
    const appearance = { showFollowUs: false, showTrustpilot: false };
    const snapshot = { revision: 1, appearance, network: { restrictPorts: true, allocations: [] } };
    const { default: router } = loadWithMocks('../src/routes/system.ts', {
        express, '../utils/bindAddresses.js': {}, '../utils/portPolicy.js': {},
        '../services/globalSettings.js': { globalSettings: () => ({ snapshot: () => snapshot,
            assignments: async () => { assignmentReads++; return []; }, save: async () => { saves++; return snapshot; } }) },
        '../middleware/auth.js': { rootOnly }, '../services/panelUpdates.js': {}, '../utils/httpValidation.js': {},
        '../utils/routeErrors.js': { sendRouteError: (res: any, error: any) => res.status(error.statusCode || 500).json({ error: error.message }) }, '../utils/time.js': {},
    });
    const app = express(); app.use(express.json());
    // Authentication boundary mirrors index.ts; rootOnly below is the actual middleware.
    app.use((req: any, res, next) => { if (!req.headers['x-test-role']) { res.sendStatus(401); return; } req.user = { isRoot: req.headers['x-test-role'] === 'root' }; next(); });
    app.use('/api/system', router);
    const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/system`;
    try {
        assert.equal((await fetch(`${url}/settings`)).status, 401);
        for (const method of ['GET', 'PUT']) assert.equal((await fetch(`${url}/settings`, { method, headers: { 'x-test-role': 'user' } })).status, 403);
        assert.equal(saves + assignmentReads, 0);
        assert.deepEqual(await (await fetch(`${url}/appearance`, { headers: { 'x-test-role': 'user' } })).json(), appearance);
        assert.equal((await fetch(`${url}/settings`, { headers: { 'x-test-role': 'root' } })).status, 200);
        assert.equal(assignmentReads, 1);
        assert.equal((await fetch(`${url}/settings`, { method: 'PUT', headers: { 'x-test-role': 'root', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snapshot, unexpected: true }) })).status, 400);
        assert.equal(saves, 0);
        assert.equal((await fetch(`${url}/settings`, { method: 'PUT', headers: { 'x-test-role': 'root', 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })).status, 200);
        assert.equal(saves, 1);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
