import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { proxyRuntime } from '../src/nodes/transport.js';
import { secret, RequestVerifier } from '../src/nodes/protocol.js';

test('streaming gateway strips browser credentials, binds requests and preserves bytes/ranges', async () => {
    const key = secret(),
        nodeId = randomUUID(),
        verifier = new RequestVerifier();
    const payload = Buffer.alloc(3 * 1024 * 1024, 71);
    const agent = http.createServer((req, res) => {
        assert.equal(req.headers.authorization, undefined);
        assert.equal(req.headers.cookie, undefined);
        verifier.verify(
            String(req.headers['x-gamepanel-node-auth']),
            key,
            nodeId,
            req.method!,
            req.url!,
        );
        assert.equal(req.headers['idempotency-key'], 'stable-command-0001');
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            assert.deepEqual(Buffer.concat(chunks), payload);
            res.writeHead(206, {
                'content-type': 'application/octet-stream',
                'content-range': 'bytes 0-1023/3145728',
                'set-cookie': 'must-not-leak',
            });
            res.end(payload.subarray(0, 1024));
        });
    });
    agent.listen(0, '127.0.0.1');
    await once(agent, 'listening');
    const origin = `http://127.0.0.1:${(agent.address() as any).port}`;
    const gateway = http.createServer((req, res) =>
        proxyRuntime(req, res, {
            origin,
            nodeId,
            key,
            path: '/api/servers/1/files/upload',
            actor: 'Admin',
        }),
    );
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    try {
        const response = await fetch(
            `http://127.0.0.1:${(gateway.address() as any).port}`,
            {
                method: 'PUT',
                headers: {
                    authorization: 'Bearer browser-secret',
                    cookie: 'private=cookie',
                    'idempotency-key': 'stable-command-0001',
                },
                body: payload,
            },
        );
        assert.equal(response.status, 206);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.equal(
            response.headers.get('content-range'),
            'bytes 0-1023/3145728',
        );
        assert.deepEqual(
            Buffer.from(await response.arrayBuffer()),
            payload.subarray(0, 1024),
        );
    } finally {
        gateway.closeAllConnections();
        gateway.close();
        agent.closeAllConnections();
        agent.close();
    }
});

test('created download capability is transformed; redirects and unavailable agents never fall back', async () => {
    let mode = 'created';
    const agent = http.createServer((_q, r) => {
        if (mode === 'redirect') {
            r.writeHead(302, { location: 'https://other.example.com' });
            r.end();
        } else {
            r.writeHead(201, { 'content-type': 'application/json' });
            r.end('{"path":"/api/download/secret"}');
        }
    });
    agent.listen(0, '127.0.0.1');
    await once(agent, 'listening');
    const origin = `http://127.0.0.1:${(agent.address() as any).port}`;
    const gateway = http.createServer((q, r) =>
        proxyRuntime(q, r, {
            origin,
            nodeId: randomUUID(),
            key: secret(),
            path: '/api/servers/1/files/download-token',
            actor: 'Admin',
            transformJson: (v) => ({ ...v, path: '/api/node-download/opaque' }),
        }),
    );
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const url = `http://127.0.0.1:${(gateway.address() as any).port}`;
    try {
        const created = await fetch(url);
        assert.equal(created.status, 201);
        assert.equal((await created.json()).path, '/api/node-download/opaque');
        mode = 'redirect';
        const redirect = await fetch(url);
        assert.equal(redirect.status, 502);
        assert.equal(redirect.headers.get('location'), null);
        agent.closeAllConnections();
        await new Promise<void>((resolve) => agent.close(() => resolve()));
        const unavailable = await fetch(url);
        assert.equal(unavailable.status, 503);
        assert.match((await unavailable.json()).error, /No local fallback/);
    } finally {
        gateway.closeAllConnections();
        gateway.close();
        agent.close();
    }
});

test('HTTPS gateway rejects an untrusted certificate and accepts an explicitly configured CA', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gp-node-tls-'));
    const previous = process.env.GAMEPANEL_NODE_CA;
    const cert = path.join(directory, 'cert.pem'),
        key = path.join(directory, 'key.pem');
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            key,
            '-out',
            cert,
            '-days',
            '1',
            '-subj',
            '/CN=localhost',
            '-addext',
            'subjectAltName=IP:127.0.0.1',
        ],
        { stdio: 'ignore' },
    );
    const agent = https.createServer(
        { key: readFileSync(key), cert: readFileSync(cert) },
        (_q, r) => r.end('verified TLS'),
    );
    agent.listen(0, '127.0.0.1');
    await once(agent, 'listening');
    const origin = `https://127.0.0.1:${(agent.address() as any).port}`;
    const gateway = http.createServer((q, r) =>
        proxyRuntime(q, r, {
            origin,
            nodeId: randomUUID(),
            key: secret(),
            path: '/api/health',
            actor: 'Admin',
        }),
    );
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const url = `http://127.0.0.1:${(gateway.address() as any).port}`;
    try {
        delete process.env.GAMEPANEL_NODE_CA;
        assert.equal((await fetch(url)).status, 503);
        process.env.GAMEPANEL_NODE_CA = cert;
        const trusted = await fetch(url);
        assert.equal(trusted.status, 200);
        assert.equal(await trusted.text(), 'verified TLS');
    } finally {
        if (previous === undefined) delete process.env.GAMEPANEL_NODE_CA;
        else process.env.GAMEPANEL_NODE_CA = previous;
        gateway.closeAllConnections();
        gateway.close();
        agent.closeAllConnections();
        agent.close();
        rmSync(directory, { recursive: true });
    }
});
