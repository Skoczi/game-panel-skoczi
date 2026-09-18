import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { loadWithMocks } from './loadWithMocks.js';
import { AllocationError } from '../src/nodes/allocations.js';
import { RequestVerifier, secret, signNodeRequest } from '../src/nodes/protocol.js';
import { DEFAULT_APPEARANCE, validateGlobalSettings } from '../src/services/globalSettingsStore.js';

test('allocation transport signs requests and only trusts durable agent outcomes when releasing reservations', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', key = secret();
    const value = { revision: 1, appearance: { siteName: 'Unchanged agent branding' }, network: { restrictPorts: true, allocations: [] } };
    let code = 200, outcome: any = { state: 'completed', status: 409 };
    const operation = 'allocation-operation-1234';
    const verifier = new RequestVerifier();
    let writes = 0;
    const server = http.createServer(async (req, res) => {
        try {
            verifier.verify(String(req.headers['x-gamepanel-node-auth']), key, id, req.method!, req.url!);
            assert.equal(req.headers.authorization, undefined);
            if (req.url === `/api/operations/${operation}`) {
                assert.equal(req.method, 'GET'); res.writeHead(200); res.end(JSON.stringify(outcome)); return;
            }
            assert.equal(req.url, '/api/system/settings');
            if (req.method === 'PUT') {
                assert.equal(req.headers['idempotency-key'], operation);
                const chunks = []; for await (const chunk of req) chunks.push(chunk);
                assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), value);
                writes++;
            }
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(code === 200 ? value : { error: 'Rejected' }));
        } catch { res.writeHead(500); res.end('{}'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const node = { id, origin: `http://127.0.0.1:${(server.address() as any).port}`, enabled: 1, key_encrypted: 'encrypted' };
    const { allocationRuntime } = loadWithMocks('../src/nodes/allocationRuntime.ts', {
        'node:http': http, 'node:https': https,
        './protocol.js': { signNodeRequest }, './transport.js': { nodeTls: () => ({}) },
        '../services/globalSettings.js': {}, './allocations.js': { AllocationError },
        '../services/globalSettingsStore.js': { DEFAULT_APPEARANCE, validateGlobalSettings },
    }, { URL, Buffer, setTimeout, clearTimeout });
    const adapter = allocationRuntime({ all: async () => [] }, { get: async () => node, key: () => key });
    try {
        assert.deepEqual(JSON.parse(JSON.stringify(await adapter.read(id))), value);
        await adapter.write(id, value, operation);
        code = 409;
        await assert.rejects(adapter.write(id, value, operation), (error: any) => error.definitive === true);
        outcome = { state: 'uncertain', status: null };
        await assert.rejects(adapter.write(id, value, operation), (error: any) => error.definitive === false);
        code = 403; outcome = { state: 'running', status: null };
        await assert.rejects(adapter.write(id, value, operation), (error: any) => error.definitive === false);
        assert.equal(writes, 4);
        node.enabled = 0;
        await assert.rejects(adapter.write(id, value, operation), (error: any) => error.definitive === false);
        assert.equal(writes, 4);
    } finally {
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
