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
import { nativeScriptArchive } from '../src/services/nativeScript.js';
import tar from 'tar-stream';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const recipe = () => validateTemplate(structuredClone(NATIVE_CS16_TEMPLATE));
test('native configuration links are validated, signed and keep old snapshots unchanged', () => {
    const original = recipe();
    assert.equal(Object.hasOwn(original, 'configFiles'), false);
    const document = validateTemplate({ ...original, configFiles: [{ root: 'data', path: '/serverfiles/cstrike/server.cfg', label: 'Server configuration' }] });
    assert.equal(document.configFiles?.[0].root, 'data');
    assert.equal(templateHash(validateTemplate(document)), templateHash(document));
    assert.notEqual(templateHash(document), templateHash(original));
    for (const entry of [
        { root: 'missing', path: '/server.cfg', label: 'Config' },
        { root: 'data', path: '/../etc/passwd', label: 'Config' },
        { root: 'data', path: '/foo/../server.cfg', label: 'Config' },
        { root: 'data', path: 'server.cfg', label: 'Config' },
        { root: 'data', path: '/foo/', label: 'Config' },
    ]) assert.throws(() => validateTemplate({ ...original, configFiles: [entry] }));
    assert.throws(() => validateTemplate({ ...document, configFiles: [...document.configFiles!, ...document.configFiles!] }));
    const shipped = validateTemplate(JSON.parse(readFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8')));
    assert(shipped.lifecycle!.startup.join(' ').includes('/data/serverfiles'));
    assert.equal(shipped.configFiles?.length, 4);
});
test('legacy schema-2 command snapshot canonical ordering remains unchanged', () => {
    const t = recipe();
    const legacy = structuredClone(t);
    for (const phase of ['install', 'update'] as const) legacy.lifecycle![phase] = t.lifecycle![phase].map(s => ({ name: s.name, argv: s.argv!, timeoutSeconds: s.timeoutSeconds }));
    assert.equal(JSON.stringify(t), JSON.stringify(legacy));
    assert.equal(templateHash(validateTemplate(legacy)), templateHash(legacy));
});
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
    native();
    const nextRequest = enterServerMutation(41);
    request(); // A completed response cannot release a subsequent request's lock.
    assert.throws(() => enterServerMutation(41), /progress/);
    nextRequest();
});

function runtimeHarness(mode: 'success' | 'failure' | 'timeout' | 'cleanup' | 'upload' = 'success', template = recipe()) {
    const calls: any[] = [];
    const container = { putArchive: async (archive: Buffer, opts: any) => { calls.push({ archive, opts }); if (mode === 'upload') throw new Error('DO-NOT-LEAK secret'); }, start: async () => calls.push('start'), wait: async () => mode === 'timeout' ? new Promise(() => {}) : { StatusCode: mode === 'failure' ? 3 : 0 }, remove: async () => { calls.push('remove'); if (mode === 'cleanup') throw new Error('Docker unavailable'); } };
    const module = loadWithMocks('../src/services/nativeRuntime.ts', {
        'node:crypto': { randomUUID },
        '../utils/docker/client.js': { docker: { createContainer: async (spec: any) => { calls.push(spec); return container; } } },
        '../utils/docker/ownership.js': { runtimeLabels: () => ({}) },
        '../database/index.js': { serverRepository: { findById: async () => ({ id: 1 }) }, actionsRepository: { create: async () => {} }, installProgressRepository: { update: async () => {} } },
        './nativeLogs.js': { captureNativeLogs: async () => ({ finish: async () => {} }) },
        '../templates/nativeContract.js': { renderNativeArgv },
        './nativeScript.js': { nativeScriptArchive },
    }, { setTimeout: (fn: () => void) => setTimeout(fn, 10), clearTimeout });
    return { calls, module, run: () => module.runNativeSteps({ serverId: 1, image: 'sha256:fixed', template, phase: 'install', env: { MAP: 'de_dust2', MAX_PLAYERS: '16', SERVER_PORT: '27015' }, mounts: [{ hostPath: '/owned/data', containerPath: '/data' }] }) };
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
        './nativeLogs.js': {},
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
        './nativeScript.js': { nativeScriptArchive },
    });
    await module.recoverNativeOperations();
    assert.deepEqual(calls, ['remove:owned-step', 'stop:owned-game', 'failed', 'audit']);
    assert.equal(stored.desired_state, 'stopped');
    assert.deepEqual(JSON.parse(stored.runtime_config_json), { volumeUid: 1000, nativeInterrupted: true });
});
test('explicit update uses the installed image, locks power/data mutations and leaves the game stopped', async () => {
    const template = recipe();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let stepInput: any;
    let server: any = { id: 42, status: 'stopped', desired_state: 'stopped', docker_container_id: 'owned-game', runtime_config_json: '{}', provider_metadata_json: JSON.stringify({ template: { document: template, hash: templateHash(template) } }) };
    const module = loadWithMocks('../src/services/nativeUpdate.ts', {
        '../database/index.js': { serverRepository: { findById: async () => server, update: async (_id: number, patch: any) => { server = { ...server, ...patch }; }, markFailed: async () => { throw new Error('unexpected failure'); } }, actionsRepository: { create: async () => {} } },
        '../utils/docker/client.js': { docker: { getContainer: () => ({ inspect: async () => ({ State: { Status: 'exited' }, Image: 'sha256:installed-image' }) }) } },
        '../providers/runtimeConfig.js': { parseStoredEnv: () => ['MAP=de_dust2', 'MAX_PLAYERS=16', 'SERVER_PORT=27015'], parseStoredMounts: () => template.mounts, parseStoredPorts: () => ({ tcp: [], udp: [{ container: 27015, host: 27020 }] }) },
        '../utils/storage.js': { ensureServerMountDirs: async () => [{ hostPath: '/owned/data', containerPath: '/data' }] },
        '../templates/nativeContract.js': { nativeTemplate, nativeEnvironment: (await import('../src/templates/nativeContract.js')).nativeEnvironment },
        './nativeOperationLock.js': { acquireNativeOperation },
        './nativeRuntime.js': { runNativeSteps: async (input: any) => { stepInput = input; await pending; }, NativeCleanupError: class extends Error {} },
        '../utils/logger.js': { logError: () => { throw new Error('unexpected logging'); } },
        './nativeImages.js': { inspectNativeImage: async () => { throw new Error('Legacy templates must retain original update image'); } },
    });
    await module.startNativeUpdate(42, 'admin');
    assert.equal(stepInput.image, 'sha256:installed-image');
    assert.equal(stepInput.phase, 'update');
    assert.equal(JSON.parse(server.runtime_config_json).nativeOperation, 'update');
    assert.throws(() => enterServerMutation(42), /native install/);
    await assert.rejects(module.startNativeUpdate(42, 'admin'), /native install/);
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(server.status, 'stopped');
    assert.equal(JSON.parse(server.runtime_config_json).nativeInterrupted, false);
    assert.equal(JSON.parse(server.runtime_config_json).nativeOperation, undefined);
    enterServerMutation(42)();
});

test('scripts preserve literal source, are signed and reject ambiguous or unsafe schema fields', () => {
    const t = recipe();
    t.lifecycle!.installerImage = 'gamepanel-installer:steamcmd-v1';
    t.lifecycle!.install = [{ name: 'Install', script: '#!/bin/bash\nprintf "%s" "${MAP}"\n# {{MAP}} is literal source\n', timeoutSeconds: 30 }];
    const valid = validateTemplate(t);
    assert.equal(valid.lifecycle!.install[0].script, t.lifecycle!.install[0].script);
    assert.equal(valid.lifecycle!.installerImage, 'gamepanel-installer:steamcmd-v1');
    const snapshot = { id: 'scripted', version: 1, hash: templateHash(valid), document: valid };
    assert.equal(readTemplateTicket(issueTemplateTicket(snapshot, 'key', 'local'), 'key', 'local').hash, snapshot.hash);
    const tampered = structuredClone(valid); tampered.lifecycle!.install[0].script += '# changed';
    assert.throws(() => nativeTemplate({ template: { ...snapshot, document: tampered } }), /checksum/);
    for (const mutation of [
        (v: any) => { v.lifecycle.install[0].argv = ['/bin/true']; },
        (v: any) => { v.lifecycle.install[0].script = ''; },
        (v: any) => { v.lifecycle.install[0].script = 'x\u0000'; },
        (v: any) => { v.lifecycle.install[0].script = 'x\r\n'; },
        (v: any) => { v.lifecycle.install[0].script = 'x'.repeat(16385); },
        (v: any) => { v.lifecycle.install[0].script = 'ą'.repeat(9000); },
        (v: any) => { v.lifecycle.install[0].user = 'root'; },
        (v: any) => { v.lifecycle.installerImage = 'bad image'; },
        (v: any) => { v.variables.push({ key: 'BASH_ENV', label: 'Bad', default: '', type: 'string', secret: false, required: false }); },
    ]) { const invalid = structuredClone(valid); mutation(invalid); assert.throws(() => validateTemplate(invalid)); }
});

test('Bash source is uploaded as a non-root owned file, never interpolated or placed in argv', async () => {
    const t = recipe();
    const script = '#!/bin/bash\nprintf "%s" "${MAP}"\n# {{MAP}}';
    t.lifecycle!.install = [{ name: 'Script', script, timeoutSeconds: 10 }];
    const h = runtimeHarness('success', t); await h.run();
    const spec = h.calls[0];
    assert.equal(spec.Cmd[0], '/bin/bash');
    assert.ok(spec.Cmd.includes('pipefail'));
    assert.ok(!spec.Cmd.includes(script));
    assert.equal(h.calls[1].opts.path, '/tmp');
    const extract = tar.extract();
    const parsed = new Promise<void>((resolve, reject) => {
        extract.on('entry', (header, stream, next) => {
            assert.equal(header.name, spec.Cmd.at(-1).slice('/tmp/'.length));
            assert.equal(header.uid, 1000); assert.equal(header.gid, 1000); assert.equal(header.mode, 0o400);
            const chunks: Buffer[] = []; stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => { assert.equal(Buffer.concat(chunks).toString(), script); next(); });
        });
        extract.on('finish', resolve); extract.on('error', reject);
    });
    extract.end(h.calls[1].archive); await parsed;
    assert.equal(h.calls[2], 'start');
    const failed = runtimeHarness('upload', t);
    await assert.rejects(failed.run(), /could not execute/);
    assert.ok(!failed.calls.includes('start')); assert.equal(failed.calls.at(-1), 'remove');
    const timeout = runtimeHarness('timeout', t); await assert.rejects(timeout.run(), /timed out/); assert.equal(timeout.calls.at(-1), 'remove');
});

test('shared HLDS example validates and Bash scripts have valid syntax without execution', () => {
    const document = validateTemplate(JSON.parse(readFileSync(new URL('../../examples/game-templates/cs16-scripted.json', import.meta.url), 'utf8')));
    assert.equal(document.lifecycle!.installerImage, 'gamepanel-installer:steamcmd-v1');
    assert.notEqual(document.runtime.image, document.lifecycle!.installerImage);
    for (const step of [...document.lifecycle!.install, ...document.lifecycle!.update]) {
        assert.ok(step.script);
        execFileSync('/bin/bash', ['-n'], { input: step.script });
    }
});

test('updates use the saved installer ID and reject lost pins before scheduling work', async () => {
    const template = recipe(); template.lifecycle!.installerImage = 'shared-installer:mutable-tag';
    const document = validateTemplate(template);
    let server: any = { id: 97, status: 'stopped', desired_state: 'stopped', docker_container_id: 'game', runtime_config_json: '{"nativeInstallerImage":"sha256:saved-installer"}', provider_metadata_json: JSON.stringify({ template: { document, hash: templateHash(document) } }) };
    let runImage = ''; let inspected = '';
    let unavailable = false;
    const module = loadWithMocks('../src/services/nativeUpdate.ts', {
        '../database/index.js': { serverRepository: { findById: async () => server, update: async (_id: number, patch: any) => { server = { ...server, ...patch }; } }, actionsRepository: { create: async () => {} } },
        '../utils/docker/client.js': { docker: { getContainer: () => ({ inspect: async () => ({ State: { Status: 'exited' }, Image: 'sha256:game' }) }) } },
        '../providers/runtimeConfig.js': { parseStoredEnv: () => [], parseStoredMounts: () => [], parseStoredPorts: () => ({ tcp: [], udp: [] }) },
        '../utils/storage.js': { ensureServerMountDirs: async () => [] },
        '../templates/nativeContract.js': { nativeTemplate, nativeEnvironment: () => ({}) },
        './nativeOperationLock.js': { acquireNativeOperation },
        './nativeRuntime.js': { runNativeSteps: async (input: any) => { runImage = input.image; }, NativeCleanupError: class extends Error {} },
        './nativeImages.js': { inspectNativeImage: async (image: string) => { inspected = image; if (unavailable) throw new Error('Missing pinned image'); return image; } },
        '../utils/logger.js': { logError: () => { throw new Error('Unexpected background failure'); } },
    });
    await module.startNativeUpdate(97, 'admin');
    await new Promise<void>(r => setImmediate(r));
    assert.equal(runImage, 'sha256:saved-installer'); assert.equal(inspected, runImage);
    assert.equal(JSON.parse(server.runtime_config_json).nativeInstallerImage, runImage);
    unavailable = true; runImage = '';
    await assert.rejects(module.startNativeUpdate(97, 'admin'), /Missing pinned image/);
    assert.equal(runImage, ''); enterServerMutation(97)();
    server.runtime_config_json = '{}';
    await assert.rejects(module.startNativeUpdate(97, 'admin'), /Pinned installer image is missing/);
    enterServerMutation(97)();
});
