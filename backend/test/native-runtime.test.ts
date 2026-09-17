import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';
import { validateTemplate, templateHash } from '../src/templates/schema.js';
import { materializeTemplate, issueTemplateTicket, readTemplateTicket } from '../src/templates/tickets.js';
import { nativeTemplate, nativeContainerOptions, renderNativeArgv } from '../src/templates/nativeContract.js';
import { acquireNativeOperation, enterServerMutation } from '../src/services/nativeOperationLock.js';
import { loadWithMocks } from './loadWithMocks.js';
import { ownsContainer } from '../src/utils/docker/ownership.js';

const recipe = () => validateTemplate(structuredClone(NATIVE_CS16_TEMPLATE));
test('native recipe is signed, node-bound, local and renders argv without a shell', () => {
    const document = recipe();
    const s = { id: 'native-test', version: 1, document, hash: templateHash(document) };
    assert.equal(nativeTemplate({ template: s })?.schemaVersion, 2);
    assert.throws(() => nativeTemplate({ template: { ...s, hash: 'wrong' } }), /checksum/);
    const ticket = issueTemplateTicket(s, 'test-key', 'node-a');
    assert.equal(readTemplateTicket(ticket, 'test-key', 'node-a').hash, s.hash);
    assert.throws(() => readTemplateTicket(ticket, 'test-key', 'node-b'));
    const body = materializeTemplate(s, { bindings: [{ key: 'game', host: 27020, hostIp: '192.0.2.10' }], variables: { MAP: 'de_dust2; touch /tmp/should-not-run' } }, 'x64');
    const options = nativeContainerOptions(document, Object.entries(body.env).map(([k, v]) => `${k}=${v}`), body.ports);
    assert.equal(options.command[0], '/data/hlds_linux');
    assert.equal(options.command.at(-1), 'de_dust2; touch /tmp/should-not-run');
    assert.equal(options.user, '1000:1000');
    assert.ok(options.command.includes('27015'));
    assert.ok(!options.command.includes('27020'));
    assert.deepEqual(renderNativeArgv(['/bin/tool', '{{MAP}}'], { MAP: '{{OTHER}}' }), ['/bin/tool', '{{OTHER}}']);
    assert.throws(() => nativeContainerOptions(document, ['MAP=x', 'MAX_PLAYERS=16', 'SERVER_PORT=27020'], body.ports), /managed port/);
    assert.throws(() => nativeContainerOptions(document, ['LD_PRELOAD=evil'], body.ports), /Unknown/);
});
test('native schema rejects unbounded, malformed or legacy lifecycle definitions', () => {
    for (const mutate of [
        (t: any) => { t.schemaVersion = 1; },
        (t: any) => { t.runtime.provider = 'linuxgsm'; },
        (t: any) => { t.lifecycle.startup = ['{{MAP}}']; },
        (t: any) => { t.lifecycle.startup = ['/bin/tool', '{{UNKNOWN}}']; },
        (t: any) => { t.lifecycle.install[0].timeoutSeconds = 0; },
        (t: any) => { t.lifecycle.install[0].timeoutSeconds = 3601; },
        (t: any) => { t.lifecycle.workdir = '/etc'; },
        (t: any) => { t.lifecycle.stopSignal = 'SIGKILL'; },
        (t: any) => { t.variables[0].secret = true; t.variables[0].default = ''; },
    ]) { const t = recipe(); mutate(t); assert.throws(() => validateTemplate(t)); }
});
test('native maintenance and regular mutations are mutually exclusive, with explicit release', () => {
    const request = enterServerMutation(41);
    assert.throws(() => enterServerMutation(41), /progress/);
    assert.throws(() => acquireNativeOperation(41), /progress/);
    const native = acquireNativeOperation(41, true);
    request();
    assert.throws(() => enterServerMutation(41), /native install/);
    assert.throws(() => acquireNativeOperation(41), /native install/);
    native(); enterServerMutation(41)();
});

function runtimeHarness(mode: 'success' | 'failure' | 'timeout' | 'cleanup' = 'success') {
    const calls: any[] = [];
    const container = { start: async () => calls.push('start'), wait: async () => mode === 'timeout' ? new Promise(() => {}) : { StatusCode: mode === 'failure' ? 3 : 0 }, remove: async () => { calls.push('remove'); if (mode === 'cleanup') throw new Error('Docker unavailable'); } };
    const module = loadWithMocks('../src/services/nativeRuntime.ts', {
        'node:crypto': { randomUUID },
        '../utils/docker/client.js': { docker: { createContainer: async (spec: any) => { calls.push(spec); return container; } } },
        '../utils/docker/ownership.js': {},
        '../database/index.js': { serverRepository: { findById: async () => ({ id: 1 }) }, actionsRepository: { create: async () => {} } },
        '../templates/nativeContract.js': { renderNativeArgv },
    }, { setTimeout: (fn: () => void) => setTimeout(fn, 10), clearTimeout });
    return { calls, module, run: () => module.runNativeSteps({ serverId: 1, image: 'sha256:fixed', template: recipe(), phase: 'install', env: { MAP: 'de_dust2', MAX_PLAYERS: '16', SERVER_PORT: '27015' }, mounts: [{ hostPath: '/owned/data', containerPath: '/data' }] }) };
}
test('native installer uses isolated non-root container, pinned image and no inherited entrypoint', async () => {
    const h = runtimeHarness(); await h.run();
    const spec = h.calls[0];
    assert.equal(spec.Image, 'sha256:fixed');
    assert.equal(spec.User, '1000:1000');
    assert.equal(spec.Entrypoint.length, 0);
    assert.equal(spec.HostConfig.CapDrop[0], 'ALL');
    assert.equal(spec.HostConfig.SecurityOpt[0], 'no-new-privileges:true');
    assert.equal(spec.HostConfig.PortBindings, undefined);
    assert.equal(spec.Labels['gamepanel.serverId'], '1');
    assert.equal(spec.Labels['gamepanel.nativeOperation'], 'install');
    assert.equal(h.calls.at(-1), 'remove');
});
test('failed and timed out installers are removed and cleanup failure is distinguished', async () => {
    const failed = runtimeHarness('failure'); await assert.rejects(failed.run(), /exit 3/); assert.equal(failed.calls.at(-1), 'remove');
    const timeout = runtimeHarness('timeout'); await assert.rejects(timeout.run(), /timed out/); assert.equal(timeout.calls.at(-1), 'remove');
    const cleanup = runtimeHarness('cleanup'); await assert.rejects(cleanup.run(), cleanup.module.NativeCleanupError);
});
test('boot recovery stops only owned maintenance, preserves data and blocks automatic replay', async () => {
    const calls: string[] = [];
    let stored: any;
    const module = loadWithMocks('../src/services/nativeRuntime.ts', {
        'node:crypto': { randomUUID },
        '../utils/docker/client.js': { docker: {
            listContainers: async () => [
                { Id: 'owned-step', Labels: { 'gamepanel.managed': 'true' } },
                { Id: 'foreign-step', Labels: { 'gamepanel.managed': 'true', 'gamepanel.node': 'different-runtime' } },
            ],
            getContainer: (id: string) => ({ remove: async () => calls.push(`remove:${id}`), inspect: async () => ({ State: { Running: true } }), stop: async () => calls.push(`stop:${id}`) }),
        } },
        '../utils/docker/ownership.js': { ownsContainer },
        '../database/index.js': {
            serverRepository: { listAll: async () => [{ id: 1, docker_container_id: 'owned-game', runtime_config_json: '{"nativeOperation":"update","volumeUid":1000}' }], update: async (_id: number, value: any) => { stored = value; }, markFailed: async () => calls.push('failed') },
            actionsRepository: { create: async () => calls.push('audit') }, installProgressRepository: { update: async () => {} },
        },
        '../templates/nativeContract.js': { renderNativeArgv },
    });
    await module.recoverNativeOperations();
    assert.deepEqual(calls, ['remove:owned-step', 'stop:owned-game', 'failed', 'audit']);
    assert.equal(stored.desired_state, 'stopped');
    assert.deepEqual(JSON.parse(stored.runtime_config_json), { volumeUid: 1000, nativeInterrupted: true });
});
