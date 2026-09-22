import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadWithMocks } from './loadWithMocks.js';

test('settings routes require root; appearance exposes no allocations', async () => {
    const { rootOnly } = loadWithMocks('../src/middleware/auth.ts', {
        '../agent/identity.js': { isAgent: () => false },
        '../utils/auth.js': {},
        '../database/index.js': {},
        '../utils/ids.js': {},
        '../utils/logger.js': {},
        '../permissions.js': {},
    });
    let saves = 0,
        assignmentReads = 0;
    const appearance = { showFollowUs: false, showTrustpilot: false };
    const snapshot = {
        revision: 1,
        appearance,
        network: { restrictPorts: true, allocations: [] },
    };
    const { default: router } = loadWithMocks('../src/routes/system.ts', {
        '../services/alerts.js': { alertStore: async () => ({ view: async () => ({ enabled: false }), save: async () => ({ enabled: false }) }) },
        '../services/alertStore.js': { validateAlertBatch: () => [] },
        express,
        '../utils/bindAddresses.js': {},
        '../utils/portPolicy.js': {},
        '../services/globalSettings.js': {
            globalSettings: () => ({
                snapshot: () => snapshot,
                assignments: async () => {
                    assignmentReads++;
                    return [];
                },
                save: async () => {
                    saves++;
                    return snapshot;
                },
            }),
        },
        '../middleware/auth.js': { rootOnly },
        '../services/panelUpdates.js': {},
        '../utils/httpValidation.js': {},
        '../utils/routeErrors.js': {
            sendRouteError: (res: any, error: any) =>
                res.status(error.statusCode || 500).json({ error: error.message }),
        },
        '../utils/time.js': {},
        '../agent/identity.js': { isAgent: () => false },
    });
    const app = express();
    app.use(express.json());
    const { default: branding } = loadWithMocks('../src/routes/branding.ts', {
        '../services/alerts.js': { alertStore: async () => ({ view: async () => ({ enabled: false }), save: async () => ({ enabled: false }) }) },
        '../services/alertStore.js': { validateAlertBatch: () => [] },
        express,
        '../services/globalSettings.js': {
            globalSettings: () => ({ snapshot: () => snapshot }),
        },
    });
    app.use('/api/branding', branding);
    // Authentication boundary mirrors index.ts; rootOnly below is the actual middleware.
    app.use((req: any, res, next) => {
        if (!req.headers['x-test-role']) {
            res.sendStatus(401);
            return;
        }
        req.user = { isRoot: req.headers['x-test-role'] === 'root' };
        next();
    });
    app.use('/api/system', router);
    const server = createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/system`;
    try {
        const publicBranding = await fetch(url.replace('/api/system', '/api/branding'));
        assert.equal(publicBranding.status, 200);
        assert.equal(publicBranding.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await publicBranding.json(), appearance);
        assert.equal(
            (
                await fetch(url.replace('/api/system', '/api/branding'), {
                    method: 'PUT',
                })
            ).status,
            401,
        );
        assert.equal((await fetch(`${url}/settings`)).status, 401);
        for (const method of ['GET', 'PUT'])
            assert.equal(
                (
                    await fetch(`${url}/settings`, {
                        method,
                        headers: { 'x-test-role': 'user' },
                    })
                ).status,
                403,
            );
        for (const [path, method] of [['notifications', 'GET'], ['notifications', 'PUT'], ['notifications/test', 'POST']]) {
            assert.equal((await fetch(`${url}/${path}`, { method, headers: { 'x-test-role': 'user' } })).status, 403);
        }
        assert.equal((await fetch(`${url}/notifications`, { headers: { 'x-test-role': 'root' } })).status, 200);
        assert.equal(saves + assignmentReads, 0);
        assert.deepEqual(
            await (await fetch(`${url}/appearance`, { headers: { 'x-test-role': 'user' } })).json(),
            appearance,
        );
        assert.equal(
            (await fetch(`${url}/settings`, { headers: { 'x-test-role': 'root' } })).status,
            200,
        );
        assert.equal(assignmentReads, 1);
        assert.equal(
            (
                await fetch(`${url}/settings`, {
                    method: 'PUT',
                    headers: {
                        'x-test-role': 'root',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ...snapshot, unexpected: true }),
                })
            ).status,
            400,
        );
        assert.equal(saves, 0);
        assert.equal((await fetch(`${url}/settings`, {
            method: 'PUT', headers: { 'x-test-role': 'root', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...snapshot, network: { restrictPorts: false, allocations: [] } }),
        })).status, 409);
        assert.equal(saves, 0);
        assert.equal(
            (
                await fetch(`${url}/settings`, {
                    method: 'PUT',
                    headers: {
                        'x-test-role': 'root',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(snapshot),
                })
            ).status,
            200,
        );
        assert.equal(saves, 1);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
