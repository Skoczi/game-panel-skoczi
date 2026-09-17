import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { NodeStore } from '../src/nodes/store.js';
import { OperationJournal } from '../src/agent/journal.js';
import {
    nodeOrigin,
    runtimePath,
    seal,
    secret,
    unseal,
    RequestVerifier,
    signNodeRequest,
} from '../src/nodes/protocol.js';
import { ownsContainer, runtimeLabels } from '../src/utils/docker/ownership.js';

function database() {
    const native = new DatabaseSync(':memory:');
    const db = {
        exec: async (sql: string) => native.exec(sql),
        run: async (sql: string, ...args: any[]) =>
            native.prepare(sql).run(...args),
        get: async (sql: string, ...args: any[]) =>
            native.prepare(sql).get(...args),
        all: async (sql: string, ...args: any[]) =>
            native.prepare(sql).all(...args),
    } as any;
    return { native, db };
}
test('agent request signatures bind node, method and exact path; expire and reject replay', () => {
    const key = secret(),
        id = randomUUID();
    const token = signNodeRequest(
        key,
        id,
        'POST',
        '/api/servers/1/start?a=1',
        'Admin',
    );
    const verifier = new RequestVerifier();
    for (const [k, n, m, p] of [
        [secret(), id, 'POST', '/api/servers/1/start?a=1'],
        [key, randomUUID(), 'POST', '/api/servers/1/start?a=1'],
        [key, id, 'GET', '/api/servers/1/start?a=1'],
        [key, id, 'POST', '/api/servers/2/start?a=1'],
    ]) {
        assert.throws(() => verifier.verify(token, k, n, m, p));
    }
    assert.equal(
        verifier.verify(token, key, id, 'POST', '/api/servers/1/start?a=1')
            .actor,
        'Admin',
    );
    assert.throws(
        () =>
            verifier.verify(token, key, id, 'POST', '/api/servers/1/start?a=1'),
        /Replay/,
    );
    const expired = jwt.sign(
        { method: 'GET', path: '/', actor: 'Admin', protocol: 1 },
        key,
        {
            issuer: 'gamepanel-control',
            audience: id,
            expiresIn: -1,
            jwtid: 'expired',
        },
    );
    assert.throws(() => verifier.verify(expired, key, id, 'GET', '/'));
    const wrongAlgorithm = jwt.sign({}, key, { algorithm: 'HS384' });
    assert.throws(() => verifier.verify(wrongAlgorithm, key, id, 'GET', '/'));
});
test('origins and runtime routes cannot escape to account, updater or arbitrary hosts', () => {
    assert.equal(
        nodeOrigin('https://node.example.com/'),
        'https://node.example.com',
    );
    for (const value of [
        'http://node.example.com',
        'https://u:p@node.example.com',
        'https://node.example.com/a',
        'https://node.example.com/?x=1',
        'file:///etc/passwd',
    ])
        assert.throws(() => nodeOrigin(value));
    assert.throws(() => nodeOrigin('http://192.0.2.1', true));
    assert.equal(
        nodeOrigin('http://127.0.0.1:3001', true),
        'http://127.0.0.1:3001',
    );
    for (const path of [
        '/api/auth/login',
        '/api/users',
        '/api/system/update',
        '//node.example.com',
        '/api/servers/../auth',
        '/api/servers/%2e%2e/auth',
        '/api/servers/%00',
        '/api/servers/%',
    ])
        assert.equal(runtimePath(path), false, path);
    for (const path of [
        '/api/servers',
        '/api/servers/1/files?path=%2Fconfig',
        '/api/servers/1/minecraft/whitelist/players/Some%20Player',
        '/api/system/settings',
    ])
        assert.equal(runtimePath(path), true, path);
});
test('credential encryption rejects wrong master, node context and tampering', () => {
    const key = secret(),
        master = secret(),
        id = randomUUID(),
        encrypted = seal(key, master, id);
    assert.equal(unseal(encrypted, master, id), key);
    assert.ok(!encrypted.includes(key));
    assert.throws(() => unseal(encrypted, secret(), id));
    assert.throws(() => unseal(encrypted, master, randomUUID()));
    const parts = encrypted.split('.');
    parts[2] = Buffer.alloc(32).toString('base64url');
    assert.throws(() => unseal(parts.join('.'), master, id));
});
test('node enrollment is single-use, credentials are redacted and revocation persists', async () => {
    const { native, db } = database();
    try {
        const store = new NodeStore(db, secret());
        await store.initialize();
        const created = await store.create(
            { name: 'Example', origin: 'https://node.example.com' },
            'Admin',
        );
        assert.equal(created.node.status, 'pending');
        const results = await Promise.allSettled([
            store.enroll(created.node.id, created.enrollmentToken),
            store.enroll(created.node.id, created.enrollmentToken),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const identity = (
            results.find(
                (r) => r.status === 'fulfilled',
            ) as PromiseFulfilledResult<any>
        ).value;
        const row = (await store.get(created.node.id))!;
        assert.equal(store.key(row), identity.key);
        const listing = JSON.stringify(await store.list());
        for (const privateValue of [
            identity.key,
            created.enrollmentToken,
            row.key_encrypted!,
            'enrollment_hash',
        ])
            assert.ok(!listing.includes(privateValue));
        await store.heartbeat(row.id, '1.5.0-test');
        assert.equal((await store.list())[0].status, 'online');
        native
            .prepare('UPDATE execution_nodes SET last_seen=?')
            .run(Date.now() - 61000);
        assert.equal((await store.list())[0].status, 'offline');
        await store.setEnabled(row.id, false, 'Admin');
        assert.throws(() => store.key({ ...row, enabled: 0 }));
        assert.equal((await store.list())[0].status, 'disabled');
        await store.setEnabled(row.id, true, 'Admin');
        const next = await store.renewEnrollment(row.id, 'Admin');
        assert.throws(() => store.key({ ...row, key_encrypted: null }));
        await assert.rejects(store.enroll(row.id, created.enrollmentToken));
        native.prepare('UPDATE execution_nodes SET enrollment_expires=0').run();
        await assert.rejects(store.enroll(row.id, next.enrollmentToken));
        await store.initialize();
        assert.equal((await store.list()).length, 1);
    } finally {
        native.close();
    }
});
test('durable operation journal blocks duplicate execution and marks interrupted operations uncertain', async () => {
    const { native, db } = database();
    try {
        const journal = new OperationJournal(db);
        await journal.initialize();
        assert.equal(
            await journal.admit('command-1', 'fingerprint'),
            undefined,
        );
        assert.equal(
            (await journal.admit('command-1', 'fingerprint'))!.state,
            'running',
        );
        await journal.complete('command-1', 201, '{"id":1}');
        assert.equal(
            (await journal.admit('command-1', 'fingerprint'))!.response,
            '{"id":1}',
        );
        assert.equal(
            (await journal.admit('command-1', 'different'))!.fingerprint,
            'fingerprint',
        );
        await journal.admit('command-2', 'second');
        const restarted = new OperationJournal(db);
        await restarted.initialize();
        assert.equal(
            (await restarted.admit('command-2', 'second'))!.state,
            'uncertain',
        );
        assert.equal((await restarted.lookup('command-1')).state, 'completed');
        assert.equal((await restarted.lookup('command-1')).response, undefined);
    } finally {
        native.close();
    }
});
test('Docker ownership separates agents, foreign containers and legacy local containers', () => {
    const previous = process.env.GAMEPANEL_NODE_ID;
    try {
        delete process.env.GAMEPANEL_NODE_ID;
        assert.equal(ownsContainer({ 'gamepanel.managed': 'true' }), true);
        const node = randomUUID();
        process.env.GAMEPANEL_NODE_ID = node;
        assert.equal(ownsContainer({ 'gamepanel.managed': 'true' }), false);
        assert.equal(
            ownsContainer({
                'gamepanel.managed': 'true',
                'gamepanel.node': randomUUID(),
            }),
            false,
        );
        assert.equal(
            ownsContainer({ 'gamepanel.managed': 'true', ...runtimeLabels() }),
            true,
        );
        assert.equal(ownsContainer(runtimeLabels()), false);
    } finally {
        if (previous === undefined) delete process.env.GAMEPANEL_NODE_ID;
        else process.env.GAMEPANEL_NODE_ID = previous;
    }
});
