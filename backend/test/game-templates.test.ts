import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import jwt from 'jsonwebtoken';
import { CS16_TEMPLATE, validateTemplate, templateHash } from '../src/templates/schema.js';
import { TemplateStore } from '../src/templates/store.js';
import { issueTemplateTicket, readTemplateTicket, materializeTemplate } from '../src/templates/tickets.js';
import { containerHostname } from '../src/utils/docker/hostname.js';

const snapshot = () => { const document = validateTemplate(structuredClone(CS16_TEMPLATE)); return { id: 'test-cs16', version: 1, hash: templateHash(document), document }; };
const key = 'a-secret-for-tests-only-that-is-long-enough';
test('CS 1.6 template declares exactly one UDP port, with no infrastructure or client binding', () => {
    const s = snapshot();
    assert.equal(s.document.ports.length, 1); assert.equal(s.document.ports[0].protocol, 'udp');
    const body = materializeTemplate(s, { name: 'Test CS', bindings: [{ key: 'game', host: 27020, hostIp: '192.0.2.10' }], env: { BAD: 'ignored' }, ports: { tcp: [] }, dockerImage: 'attacker/image' }, 'x64');
    assert.deepEqual(body.ports, { tcp: [], udp: [{ host: 27020, container: 27015, hostIp: '192.0.2.10', label: 'Game / Query / RCON' }] });
    assert.deepEqual({ ...body.templateLinuxgsmConfig }, { port: '27015' });
    assert.equal(body.dockerImage, CS16_TEMPLATE.runtime.image); assert.equal(body.env.BAD, undefined);
    assert.equal(JSON.stringify(s).includes('192.0.2.10'), false);
});
test('import is data-only and rejects eggs, arbitrary scripts, host paths and duplicate ports', () => {
    for (const mutate of [
        (t: any) => { t.scripts = { install: 'curl | sh' }; },
        (t: any) => { t.mounts[0].hostPath = '/'; },
        (t: any) => { t.mounts[0].containerPath = '/var/run/docker.sock'; },
        (t: any) => { t.mounts[0].containerPath = '/data/../../etc'; },
        (t: any) => { t.ports.push({ ...t.ports[0], key: 'duplicate' }); },
        (t: any) => { t.runtime.gameServerName = '../escape'; },
        (t: any) => { t.ports[0].linuxgsmKey = 'port"; echo BAD'; },
        (t: any) => { t.runtime.image = 'image; command'; },
        (t: any) => { t.schemaVersion = 99; },
    ]) { const t = structuredClone(CS16_TEMPLATE); mutate(t); assert.throws(() => validateTemplate(t)); }
});
test('variables enforce types, required values and secret-free exported defaults', () => {
    const t = structuredClone(CS16_TEMPLATE);
    t.variables = [{ key: 'RCON_PASSWORD', label: 'RCON password', type: 'string', required: true, secret: true, default: '' }, { key: 'MAXPLAYERS', label: 'Players', type: 'integer', required: true, secret: false, default: '16' }];
    const document = validateTemplate(t); const s = { ...snapshot(), document, hash: templateHash(document) };
    const input = { name: 'Test CS', bindings: [{ key: 'game', host: 27015, hostIp: '192.0.2.10' }] };
    assert.throws(() => materializeTemplate(s, input, 'x64'));
    assert.throws(() => materializeTemplate(s, { ...input, variables: { RCON_PASSWORD: 'secret', MAXPLAYERS: 'bad' } }, 'x64'));
    assert.throws(() => materializeTemplate(s, { ...input, variables: { RCON_PASSWORD: 'secret', UNKNOWN: 'bad' } }, 'x64'));
    const body = materializeTemplate(s, { ...input, variables: { RCON_PASSWORD: 'actual-value' } }, 'x64');
    assert.equal(body.env.RCON_PASSWORD, 'actual-value'); assert.equal(JSON.stringify(body.templateSnapshot).includes('actual-value'), false);
    t.variables[0].default = 'leaked'; assert.throws(() => validateTemplate(t), /Secret defaults/);
    t.variables[0].default = ''; t.variables[0].secret = false; assert.throws(() => validateTemplate(t), /marked secret/);
});
test('authorization binds immutable snapshot to node, issuer and expiry', () => {
    const s = snapshot(); const ticket = issueTemplateTicket(s, key, 'node-a');
    assert.deepEqual(readTemplateTicket(ticket, key, 'node-a'), s);
    assert.throws(() => readTemplateTicket(ticket, key, 'local'));
    assert.throws(() => readTemplateTicket(ticket, key + 'wrong', 'node-a'));
    const expired = jwt.sign({ snapshot: s, protocol: 1 }, key, { issuer: 'gamepanel-templates', audience: 'node-a', expiresIn: -1 });
    assert.throws(() => readTemplateTicket(expired, key, 'node-a'));
    const tampered = issueTemplateTicket({ ...s, hash: 'wrong' }, key, 'node-a');
    assert.throws(() => readTemplateTicket(tampered, key, 'node-a'));
});
test('runtime rejects unsupported architecture, missing or duplicate bindings and wildcard addresses', () => {
    const s = snapshot(); const input = { bindings: [{ key: 'game', host: 27015, hostIp: '192.0.2.10' }] };
    assert.throws(() => materializeTemplate(s, input, 'arm64'));
    for (const bindings of [[], [...input.bindings, ...input.bindings], [{ key: 'unknown', host: 27015, hostIp: '192.0.2.10' }], [{ key: 'game', host: 80, hostIp: '192.0.2.10' }], [{ key: 'game', host: 27015, hostIp: '0.0.0.0' }]]) assert.throws(() => materializeTemplate(s, { bindings }, 'x64'));
});
test('external images require explicit non-root execution identity', () => {
    const t = structuredClone(CS16_TEMPLATE); t.runtime.provider = 'external'; t.ports[0].linuxgsmKey = '';
    assert.throws(() => validateTemplate(t));
    t.runtime.identity = { user: '1000', uid: 1000, gid: 1000 };
    const document = validateTemplate(t);
    const body = materializeTemplate({ ...snapshot(), document }, { bindings: [{ key: 'game', host: 27015, hostIp: '192.0.2.10' }] }, 'x64');
    assert.deepEqual(body.runtimeIdentity, t.runtime.identity);
    t.runtime.identity.user = 'root'; assert.throws(() => validateTemplate(t));
});
test('version store preserves published documents, rejects stale saves and keeps disable on restart', async () => {
    const native = new DatabaseSync(':memory:');
    const db = { exec: async (s: string) => native.exec(s), run: async (s: string, ...a: any[]) => native.prepare(s).run(...a), get: async (s: string, ...a: any[]) => native.prepare(s).get(...a), all: async (s: string, ...a: any[]) => native.prepare(s).all(...a) } as any;
    try {
        const store = new TemplateStore(db); await store.initialize();
        assert.equal((await store.get('builtin-cs16', 1)).status, 'draft');
        await store.status('builtin-cs16', 1, 'published', 'admin');
        const doc = { ...CS16_TEMPLATE, description: 'New revision' };
        await store.create(doc, 'admin', 'builtin-cs16', 1);
        assert.equal((await store.get('builtin-cs16', 1)).document.description, CS16_TEMPLATE.description);
        assert.equal((await store.get('builtin-cs16', 2)).status, 'draft');
        await assert.rejects(store.create(doc, 'admin', 'builtin-cs16', 1), /newer version|conflict/);
        await store.status('builtin-cs16', 1, 'disabled', 'admin'); await store.initialize();
        assert.equal((await store.get('builtin-cs16', 1)).status, 'disabled');
        await assert.rejects(store.status('builtin-cs16', 1, 'published', 'admin'), /new draft/);
        assert.equal((await store.list()).length, 3);
        assert.equal((await store.get('builtin-cs16-native', 1)).status, 'draft');
        await store.remove('builtin-cs16', 'admin');
        assert.equal((await store.list()).length, 1);
        await assert.rejects(store.get('builtin-cs16', 1), /deleted/);
        await assert.rejects(store.create(doc, 'admin', 'builtin-cs16', 2), /deleted/);
        await store.initialize();
        assert.equal((await store.list()).length, 1, 'deleted builtins must not reappear');
        assert.equal(native.prepare('SELECT COUNT(*) AS n FROM game_template_versions').get()!.n, 3, 'historical definitions preserved');
        await store.remove('builtin-cs16', 'admin');
        await assert.rejects(store.remove('missing', 'admin'), /not found/);
    } finally { native.close(); }
});
test('long remote container names become deterministic <=63 byte hostnames without losing Docker identity', () => {
    const name = 'gp-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa-counter-strike-1.6-server-1';
    assert.ok(name.length > 64); assert.ok(Buffer.byteLength(containerHostname(name)) <= 63);
    assert.match(containerHostname(name), /^[a-z0-9-]+$/);
    assert.equal(containerHostname(name), containerHostname(name));
    assert.notEqual(containerHostname(name), containerHostname(name + '2'));
    assert.equal(containerHostname('test-server-1'), 'test-server-1');
});

test('template icons round-trip through immutable versions and node tickets without changing old hashes', () => {
    const original = snapshot();
    const plain = validateTemplate(original.document);
    assert.equal(templateHash(plain), original.hash);
    assert.equal(Object.hasOwn(plain, 'icon'), false);
    for (const icon of ['counter-strike', 'counter-strike-source', 'counter-strike-go', 'counter-strike-2', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAq0lEQVR4nOXOIQEAAAgDsPfPRQnSnBgTiPkls32NBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HgAO0mywmjerl49AAAAAElFTkSuQmCC']) {
        const document = validateTemplate({ ...plain, icon });
        const s = { ...original, document, hash: templateHash(document) };
        assert.equal(readTemplateTicket(issueTemplateTicket(s, key, 'node-a'), key, 'node-a').document.icon, icon);
        const body = materializeTemplate(s, { name: 'CS', bindings: [{ key: 'game', host: 27015, hostIp: '192.0.2.10' }] }, 'x64');
        assert.equal(body.templateSnapshot.document.icon, icon);
    }
    for (const icon of ['unknown-icon', 'https://external.example/icon.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk', 'data:image/png;base64,' + 'A'.repeat(21900)])
        assert.throws(() => validateTemplate({ ...plain, icon }), /icon/);
});
