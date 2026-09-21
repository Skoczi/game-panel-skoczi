import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { FleetStore } from '../src/fleet/store.js';
import { validateDelegation, delegatedPath } from '../src/nodes/delegation.js';
import { RequestVerifier, signNodeRequest, secret } from '../src/nodes/protocol.js';
import { loadWithMocks } from './loadWithMocks.js';
import { PERMISSIONS } from '../src/permissions.js';
import {
    migration,
    RUNTIME_IDENTITY_SQL,
} from '../src/database/migrations/0002_server_runtime_identity.js';

function database() {
    const native = new DatabaseSync(':memory:');
    native.exec(
        "PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT); INSERT INTO users VALUES(1,'admin'),(2,'alice'),(3,'bob')",
    );
    const db = {
        exec: async (sql: string) => native.exec(sql),
        run: async (sql: string, ...args: any[]) => native.prepare(sql).run(...args),
        get: async (sql: string, ...args: any[]) => native.prepare(sql).get(...args),
        all: async (sql: string, ...args: any[]) => native.prepare(sql).all(...args),
    } as any;
    return { native, db };
}
const instance = 'a'.repeat(32);
test('short context aliases use the same scoped grants and unavailable checks as UUID links', async () => {
    const { native, db } = database();
    const store = new FleetStore(db);
    await store.initialize();
    const item = { id: 8, runtimeKey: instance, name: 'Arena', provider: 'native', status: 'running' };
    await store.observe('node-a', [item]);
    await store.observe('node-b', [item]);
    const [a, b] = await store.list();
    await store.grant(a.id, 2, ['server.power'], 1);
    let enabled = 1;
    const routes = new Map<string, any>();
    const router = {
        use() {}, post() {}, put() {}, delete() {},
        get(path: string, handler: any) { routes.set(path, handler); },
    };
    const control = loadWithMocks('../src/fleet/control.ts', {
        express: { Router: () => router, json: () => () => {} },
        'node:http': {}, 'node:https': {},
        '../database/init.js': { getDatabase: async () => db },
        '../database/index.js': { serverRepository: { listAll: async () => [] } },
        '../middleware/auth.js': { authMiddleware() {}, rootOnly() {} },
        '../nodes/control.js': { nodes: () => ({ list: async () => [], get: async () => ({ enabled, key_encrypted: 'test' }) }) },
        '../nodes/store.js': {}, '../nodes/transport.js': {}, '../nodes/protocol.js': {},
        '../nodes/delegation.js': {}, '../permissions.js': { ASSIGNABLE_SERVER_PERMISSIONS: ['server.power'] },
        './store.js': { FleetStore: class { constructor() { return store; } } },
        './displayIdentity.js': {},
    }, { setInterval: () => ({ unref() {} }) });
    await control.initializeFleet();
    control.mountFleet({ use() {} });
    const request = (id: string, userId = 2) => new Promise<any>((resolve, reject) => {
        let status = 200;
        routes.get('/:id/context')({ params: { id }, user: { userId, isRoot: false } }, {
            status(code: number) { status = code; return this; },
            json(body: unknown) { resolve({ status, body }); },
        }, reject);
    });
    const inventory = (isRoot: boolean) => new Promise<any>((resolve, reject) => {
        routes.get('/')({ user: { userId: isRoot ? 1 : 2, isRoot } }, { json: resolve }, reject);
    });
    const rootInventory = await inventory(true);
    assert.equal(rootInventory.servers.length, 2);
    assert.equal(rootInventory.servers.find((s: any) => s.id === a.id).node.id, a.node_id);
    const playerInventory = await inventory(false);
    assert.equal(playerInventory.servers.length, 1);
    assert.equal(playerInventory.servers[0].id, a.id);
    assert.equal('id' in playerInventory.servers[0].node, false);
    const numeric = await request(String(a.server_number));
    assert.equal(numeric.status, 200);
    assert.equal(numeric.body.id, a.id);
    assert.equal(numeric.body.nodeId, a.node_id);
    assert.equal(numeric.body.runtimeId, 8);
    assert.deepEqual(JSON.parse(JSON.stringify(numeric)), JSON.parse(JSON.stringify(await request(a.id))));
    assert.equal((await request(String(b.server_number))).status, 404);
    assert.equal((await request(String(a.server_number), 3)).status, 404);
    enabled = 0;
    assert.equal((await request(String(a.server_number))).status, 503);
    enabled = 1;
    await store.observe(a.node_id, []);
    assert.equal((await request(String(a.server_number))).status, 404);
    for (const id of ['0', '01', '-1', '9007199254740992']) assert.equal((await request(id)).status, 404);
    native.close();
});
test('global server numbers are stable, unique across nodes and never recycled', async () => {
    const { native, db } = database();
    const store = new FleetStore(db);
    await store.initialize();
    const item = { id: 1, runtimeKey: instance, name: 'Arena', provider: 'native', status: 'running' };
    await Promise.all([store.observe('node-a', [item]), store.observe('node-b', [item])]);
    const rows = await store.list();
    assert.deepEqual(rows.map(r => r.server_number).sort(), [1, 2]);
    const original = rows[0];
    assert.equal((await store.getByNumber(original.server_number!))!.id, original.id);
    assert.notEqual((await store.getByNumber(rows[1].server_number!))!.id, original.id);
    await store.grant(original.id, 2, ['server.power'], 1);
    await store.initialize();
    await store.observe(original.node_id, [{ ...item, name: 'Renamed', id: 42 }]);
    assert.equal((await store.get(original.id))!.server_number, original.server_number);
    await db.run('UPDATE fleet_servers SET node_id=? WHERE id=?', 'node-moved', original.id);
    assert.equal((await store.get(original.id))!.server_number, original.server_number);
    assert.deepEqual(await store.permissions(original.id, 2), ['server.power']);
    assert.equal((await store.getByNumber(original.server_number!))!.node_id, 'node-moved');
    await db.run('DELETE FROM fleet_servers');
    assert.equal(await store.getByNumber(original.server_number!), undefined);
    await store.observe('node-c', [item]);
    assert.equal((await store.list())[0].server_number, 3);
    native.close();
});

test('global number backfill preserves existing UUIDs and grants and is repeatable', async () => {
    const { native, db } = database();
    const store = new FleetStore(db);
    await store.initialize();
    await store.observe('local', [{ id: 1, runtimeKey: instance, name: 'Old', provider: 'native', status: 'running' }]);
    const original = (await store.list())[0];
    await store.grant(original.id, 2, ['server.power'], 1);
    native.exec('DROP TRIGGER fleet_allocate_server_number; DROP TABLE fleet_server_numbers');
    await store.initialize();
    await store.initialize();
    assert.equal((await store.get(original.id))!.server_number, 1);
    assert.deepEqual(await store.permissions(original.id, 2), ['server.power']);
    native.close();
});
const scope = {
    actorId: 2,
    serverId: 1,
    runtimeKey: instance,
    permissions: ['server.power'],
};

test('fleet catalogue metadata upgrades an existing registry without changing identity or access', async () => {
    const { native, db } = database();
    const store = new FleetStore(db);
    await store.initialize();
    const item = { id: 1, runtimeKey: instance, name: 'Arena', provider: 'ovhcloud', status: 'running' };
    await store.observe('node-a', [item]);
    const original = (await store.list())[0];
    await store.grant(original.id, 2, ['server.power'], 1);
    await store.initialize();
    await store.observe('node-a', [{ ...item, catalogId: 'counter-strike-2' }]);
    const updated = (await store.list())[0];
    assert.equal(updated.id, original.id);
    assert.equal(updated.catalog_id, 'counter-strike-2');
    assert.deepEqual(await store.permissions(original.id, 2), ['server.power']);
    await assert.rejects(store.observe('node-a', [{ ...item, catalogId: 42 as any }]));
    assert.equal((await store.get(original.id))!.catalog_id, 'counter-strike-2');
    await store.observe('node-a', [item]);
    assert.equal((await store.get(original.id))!.catalog_id, null);
    native.close();
});

test('fleet IDs and user grants distinguish identical runtime IDs on different nodes', async () => {
    const { native, db } = database();
    const store = new FleetStore(db);
    await store.initialize();
    const item = {
        id: 1,
        runtimeKey: instance,
        name: 'Arena',
        provider: 'external',
        status: 'running',
    };
    await store.observe('node-a', [item]);
    await store.observe('node-b', [item]);
    const [a, b] = await store.list();
    assert.notEqual(a.id, b.id);
    await store.grant(a.id, 2, ['server.power'], 1);
    await store.grant(b.id, 3, [], 1);
    assert.deepEqual(await store.permissions(a.id, 2), ['server.power']);
    assert.equal(await store.permissions(b.id, 2), null);
    await store.observe(a.node_id, [{ ...item, name: 'Renamed' }]);
    assert.equal((await store.get(a.id))!.name, 'Renamed');
    assert.deepEqual(await store.permissions(a.id, 2), ['server.power']);
    await assert.rejects(store.grant(a.id, 2, ['users.manage'], 1));
    await assert.rejects(store.grant(a.id, 2, ['*'], 1));
    await assert.rejects(store.grant(a.id, 2, ['server.install'], 1));
    await store.revoke(a.id, 2, 1);
    assert.equal(await store.permissions(a.id, 2), null);
    native.close();
});
test('reused runtime IDs cannot inherit grants; malformed and missing snapshots fail safely', async () => {
    const { native, db } = database();
    const store = new FleetStore(db);
    await store.initialize();
    const item = {
        id: 1,
        runtimeKey: instance,
        name: 'Original',
        provider: 'external',
        status: 'running',
    };
    await store.observe('node-a', [item]);
    const old = (await store.list())[0];
    await store.grant(old.id, 2, ['server.power'], 1);
    await assert.rejects(store.observe('node-a', [item, item]));
    assert.equal((await store.get(old.id))!.missing, 0);
    await store.observe('node-a', [
        { ...item, runtimeKey: 'b'.repeat(32), name: 'New installation' },
    ]);
    assert.equal((await store.get(old.id))!.missing, 1);
    const current = (await store.list()).find((s) => !s.missing)!;
    assert.notEqual(current.id, old.id);
    assert.equal(await store.permissions(current.id, 2), null);
    native.close();
});
test('runtime identity migration preserves rows and assigns unique keys to future inserts', async () => {
    const { native, db } = database();
    native.exec(
        "CREATE TABLE game_servers(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO game_servers VALUES(1,'Existing')",
    );
    await migration.up(db);
    await db.exec(RUNTIME_IDENTITY_SQL);
    const old = native.prepare('SELECT * FROM game_servers WHERE id=1').get() as any;
    assert.match(old.runtime_uuid, /^[a-f0-9]{32}$/);
    assert.equal(old.name, 'Existing');
    native.exec("INSERT INTO game_servers(id,name) VALUES(2,'New')");
    assert.notEqual(
        (native.prepare('SELECT runtime_uuid FROM game_servers WHERE id=2').get() as any)
            .runtime_uuid,
        old.runtime_uuid,
    );
    native.close();
});
test('delegation is single-server, excludes global permissions and is bound to protocol 2', () => {
    const key = secret(),
        node = randomUUID(),
        verifier = new RequestVerifier();
    const token = signNodeRequest(key, node, 'GET', '/api/servers', 'alice', scope);
    const claim = verifier.verify(token, key, node, 'GET', '/api/servers');
    assert.equal(claim.protocol, 2);
    assert.deepEqual(claim.delegation, scope);
    for (const permissions of [['*'], ['users.manage'], ['server.install'], ['made.up']])
        assert.throws(() => validateDelegation({ ...scope, permissions }));
    for (const path of [
        '/api/system/settings',
        '/api/servers/2',
        '/api/servers/1/members',
        '/api/servers/install',
        '/api/operations/some-operation-123',
    ])
        assert.equal(delegatedPath(path, scope, 'GET'), false);
    assert.equal(delegatedPath('/api/servers/1/start', scope, 'POST'), true);
    assert.equal(delegatedPath('/api/servers', scope, 'POST'), false);
    const downgrade = jwt.sign(
        {
            method: 'GET',
            path: '/api/servers',
            actor: 'alice',
            delegation: scope,
            protocol: 1,
        },
        key,
        {
            audience: node,
            issuer: 'gamepanel-control',
            expiresIn: 30,
            jwtid: randomUUID(),
        },
    );
    assert.throws(() => new RequestVerifier().verify(downgrade, key, node, 'GET', '/api/servers'));
});
test('delegated HTTP permissions never fall back to an agent-local user with the same numeric ID', async () => {
    let localReads = 0;
    const auth = loadWithMocks('../src/middleware/auth.ts', {
        '../agent/identity.js': { isAgent: () => true },
        '../utils/auth.js': {},
        '../utils/ids.js': { parsePositiveIntId: Number },
        '../utils/logger.js': {},
        '../permissions.js': { PERMISSIONS },
        '../database/index.js': {
            serverMemberRepository: {
                getUserServerPermissions: async () => {
                    localReads++;
                    return ['*'];
                },
                listByUser: async () => {
                    localReads++;
                    return [];
                },
            },
        },
    });
    const user = { userId: 2, isRoot: false, delegation: scope };
    assert.equal(await auth.userHasServerPermission(user, 1, 'server.power'), true);
    assert.equal(await auth.userHasServerPermission(user, 1, 'fs.write'), false);
    assert.equal(await auth.userHasServerPermission(user, 2, 'server.power'), false);
    const visible = await auth.buildServerVisibility(user);
    assert.equal(visible(1), true);
    assert.equal(visible(2), false);
    assert.equal((await auth.buildServerEnvVisibility(user))(1), false);
    assert.equal(localReads, 0);
    const localRoot = await auth.buildServerVisibility({ userId: 1, isRoot: true, runtimeScope: 1 });
    assert.equal(localRoot(1), true);
    assert.equal(localRoot(2), false);
});
test('WebSocket snapshots, events and metrics exclude other servers and redact environment', () => {
    const { sendSafe } = loadWithMocks('../src/websocket/auth.ts', {
        ws: { OPEN: 1 },
        '../utils/auth.js': {},
    });
    const sent: any[] = [];
    const ws = {
        readyState: 1,
        isRoot: false,
        visibleServers: new Set([1]),
        permissionsByServer: { 1: [] },
        accountValidatedAt: Date.now(),
        send: (data: string) => sent.push(JSON.parse(data)),
    };
    sendSafe(ws, {
        type: 'servers:snapshot',
        servers: [
            { id: 1, env: { SECRET: 'hidden' } },
            { id: 2, env: {} },
        ],
    });
    assert.deepEqual(sent[0].servers, [{ id: 1, env: {} }]);
    sendSafe(ws, { type: 'servers:updated', server: { id: 2, env: {} } });
    sendSafe(ws, { type: 'logs:new', serverId: 2, lines: ['private'] });
    sendSafe(ws, { type: 'system-metrics:update', metrics: { private: true } });
    assert.equal(sent.length, 1);
    sendSafe(ws, {
        type: 'servers-metrics:update',
        metrics: [{ serverId: 1 }, { serverId: 2 }],
    });
    assert.deepEqual(sent[1].metrics, [{ serverId: 1 }]);
    ws.accountValidatedAt = Date.now() - 7000;
    sendSafe(ws, { type: 'logs:new', serverId: 1, lines: ['stale'] });
    assert.equal(sent.length, 2);
    Object.assign(ws, { isRoot: true, runtimeScope: 1, accountValidatedAt: Date.now() });
    sendSafe(ws, { type: 'servers:updated', server: { id: 2, env: {} } });
    assert.equal(sent.length, 2, 'selected root workspace must not receive another server');
});
