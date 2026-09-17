import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import http, { createServer } from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { NodeStore, NodeRemovalError } from '../src/nodes/store.js';
import * as protocol from '../src/nodes/protocol.js';
import { FleetStore } from '../src/fleet/store.js';
import { loadWithMocks } from './loadWithMocks.js';
import { NodeAllocations, AllocationError } from '../src/nodes/allocations.js';

test('node deletion API is root-only and preserves registrations on rejected removal', async () => {
    const native = new DatabaseSync(':memory:');
    native.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
    const db = {
        exec: async (sql: string) => native.exec(sql),
        run: async (sql: string, ...args: any[]) => native.prepare(sql).run(...args),
        get: async (sql: string, ...args: any[]) => native.prepare(sql).get(...args),
        all: async (sql: string, ...args: any[]) => native.prepare(sql).all(...args),
    } as any;
    await new FleetStore(db).initialize();
    const { rootOnly } = loadWithMocks('../src/middleware/auth.ts', {
        '../agent/identity.js': { isAgent: () => false },
        '../utils/auth.js': {}, '../database/index.js': {}, '../utils/ids.js': {},
        '../utils/logger.js': {}, '../permissions.js': {},
    });
    let checked = 0;
    const control = loadWithMocks('../src/nodes/control.ts', {
        express, ws: {},
        '../database/init.js': { getDatabase: async () => db },
        '../config.js': { getConfig: () => ({ jwtSecret: protocol.secret() }) },
        '../middleware/auth.js': {
            rootOnly,
            authMiddleware: (req: any, res: any, next: any) => {
                const role = req.headers['x-test-role'];
                if (!role) return res.sendStatus(401);
                req.user = { isRoot: role === 'root', username: 'Admin' };
                next();
            },
        },
        '../database/index.js': {}, '../utils/auth.js': {},
        './store.js': { NodeStore, NodeRemovalError }, './protocol.js': protocol,
        './transport.js': {}, './delegation.js': {},
        './allocations.js': { NodeAllocations, AllocationError },
        './allocationRuntime.js': { allocationRuntime: () => ({}) },
        '../fleet/control.js': {
            verifyNodeEmpty: async () => { checked++; throw new NodeRemovalError('Inventory unavailable'); },
        },
    }, { process: { env: {} } });
    await control.initializeNodes();
    const store: NodeStore = control.nodes();
    const { node, enrollmentToken } = await store.create({ name: 'Pending', origin: 'https://node.example.com' }, 'Admin');
    const app = express(); control.mountNodeControl(app);
    const server = createServer(app); server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/nodes`;
    const remove = (id: string, name: string, role?: string) => fetch(`${base}/${id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
        body: JSON.stringify({ confirmationName: name }),
    });
    try {
        for (const [suffix, method] of [['local/allocations', 'GET'], ['local/allocations', 'PUT'], ['local/allocations/retry', 'POST']]) {
            assert.equal((await fetch(`${base}/${suffix}`, { method })).status, 401);
            assert.equal((await fetch(`${base}/${suffix}`, { method, headers: { 'x-test-role': 'user' } })).status, 403);
        }
        assert.equal((await remove(node.id, node.name)).status, 401);
        assert.equal((await remove(node.id, node.name, 'user')).status, 403);
        assert.equal((await remove('local', 'Local', 'root')).status, 400);
        assert.equal((await remove(node.id, 'Wrong', 'root')).status, 400);
        assert.ok(await store.get(node.id));
        assert.equal(checked, 0);
        assert.equal((await remove(node.id, node.name, 'root')).status, 200);
        assert.equal(checked, 0);
        await assert.rejects(store.enroll(node.id, enrollmentToken));
        assert.equal((await remove(node.id, node.name, 'root')).status, 404);
        const paired = await store.create({ name: 'Paired', origin: 'https://paired.example.com' }, 'Admin');
        await store.enroll(paired.node.id, paired.enrollmentToken);
        await store.setEnabled(paired.node.id, false, 'Admin');
        assert.equal((await remove(paired.node.id, paired.node.name, 'root')).status, 409);
        assert.equal(checked, 1);
        assert.ok(await store.get(paired.node.id));
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        native.close();
    }
});

test('deletion inventory verification is signed, read-only and rejects unavailable or nonempty agents', async () => {
    let response: unknown = { servers: [] };
    let status = 200;
    let reads = 0;
    const key = protocol.secret();
    const nodeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const verifier = new protocol.RequestVerifier();
    const server = createServer((req, res) => {
        try {
            assert.equal(req.method, 'GET');
            assert.equal(req.url, '/api/servers');
            assert.equal(req.headers.authorization, undefined);
            verifier.verify(String(req.headers['x-gamepanel-node-auth']), key, nodeId, 'GET', '/api/servers');
            reads++;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        } catch {
            res.writeHead(401); res.end();
        }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const node = { id: nodeId, enabled: 0, key_encrypted: 'encrypted', origin: `http://127.0.0.1:${(server.address() as any).port}` };
    const { verifyNodeEmpty } = loadWithMocks('../src/fleet/control.ts', {
        express, 'node:http': http, 'node:https': https,
        '../database/init.js': {}, '../database/index.js': {}, '../middleware/auth.js': {},
        '../nodes/control.js': { nodes: () => ({ key: () => key }) },
        '../nodes/store.js': { NodeRemovalError },
        '../nodes/transport.js': { nodeTls: () => ({}) },
        '../nodes/protocol.js': protocol, '../nodes/delegation.js': {},
        '../permissions.js': {}, './store.js': { FleetStore },
    }, { URL, Buffer, setTimeout, clearTimeout });
    try {
        await verifyNodeEmpty(node);
        response = { servers: [{ id: 1 }] };
        await assert.rejects(verifyNodeEmpty(node), /still has servers/);
        response = { servers: null };
        await assert.rejects(verifyNodeEmpty(node), /Cannot verify/);
        response = { servers: [] }; status = 503;
        await assert.rejects(verifyNodeEmpty(node), /Cannot verify/);
        assert.equal(reads, 4);
    } finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await assert.rejects(verifyNodeEmpty(node), /Cannot verify/);
});
