import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWithMocks } from './loadWithMocks.js';
import { assertPortPolicy, configuredPortPolicy } from '../src/utils/portPolicy.js';
import * as rehldsStartup from '../src/templates/rehldsStartup.js';
import { readFileSync } from 'node:fs';
import { validateTemplate, templateHash } from '../src/templates/schema.js';
import * as nativeContract from '../src/templates/nativeContract.js';

test('tightened policy blocks recreation before touching a running container or its files', async () => {
    const calls: string[] = [];
    const mark = (name: string) => async () => { calls.push(name); };
    const policy = configuredPortPolicy('{"192.0.2.10":{"tcp":"27015-27030"}}');
    const module = loadWithMocks('../src/services/serverReconfiguration.ts', {
        '../templates/rehldsStartup.js': rehldsStartup,
        '../utils/docker/client.js': {},
        './cpuTopology.js': { assertCpuBinding: async () => {} },
        './hostPortAvailability.js': {}, './portAllocationLock.js': {},
        '../templates/nativeContract.js': nativeContract,
        '../database/index.js': {}, '../providers/ovhcloud/adapters/registry.js': {},
        '../utils/portPolicy.js': { assertPortPolicy: (ports: any) => assertPortPolicy(ports, policy) },
        '../utils/storage.js': { ensureServerMountDirs: mark('mounts') },
        '../utils/docker.js': { checkContainerStatus: async () => 'running', stopContainer: mark('stop'), imageExists: mark('image') },
        '../providers/runtimeConfig.js': {
            parseStoredPorts: () => ({ tcp: [{ host: 8080, container: 8080, hostIp: '192.0.2.10' }], udp: [] }),
            parseStoredMounts: () => [], parseStoredEnv: () => [], parseStoredHealthcheck: () => null, parseStoredResourceLimits: () => null,
        },
        './serverTransitions.js': { beginServerTransition: mark('transition') },
        './servers.js': { getServerOrThrow: async () => ({ name: 'test', docker_container_id: 'test' }) },
        './ovhcloudLifecycle.js': {},
        './serverActionPolicy.js': { assertCanReconfigureContainer: () => {}, assertCanReconfigureServer: () => {} },
    });
    await assert.rejects(module.reconfigureServerContainer(1, {}), /not allowed/);
    assert.deepEqual(calls, []);
});

test('legacy hostname startup refresh recreates once without applying pending settings or renaming the panel alias', async () => {
    const document = validateTemplate(JSON.parse(readFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8')));
    document.lifecycle!.startup[2] = readFileSync(new URL('./fixtures/legacy-rehlds-start.sh', import.meta.url), 'utf8');
    document.variables.push({ key: 'SERVER_NAME', label: 'Legacy name', type: 'string', required: true, secret: false, default: 'Old name' });
    const ports = { tcp: [], udp: [{ container: 27015, host: 27050, hostIp: '192.0.2.10' }] };
    const env = ['SERVER_PORT=27015', ...document.variables.map(v => `${v.key}=${v.default}`)];
    const pending = { name: 'Unapplied alias', env: env.map(v => v.startsWith('MAP=') ? 'MAP=de_nuke' : v), resourceLimits: { cpus: 8 }, hasResourceLimitsPatch: true };
    const metadata = { template: { document, hash: templateHash(document) }, pendingConfiguration: pending };
    let server: any = { id: 7, name: 'FFA', provider: 'external', docker_container_id: 'before', docker_container_name: 'ffa', docker_image: 'pinned-image', provider_metadata_json: JSON.stringify(metadata) };
    let command = document.lifecycle!.startup;
    let created: any;
    let count = 0;
    const module = loadWithMocks('../src/services/serverReconfiguration.ts', {
        '../templates/rehldsStartup.js': rehldsStartup,
        '../utils/docker/client.js': { docker: { getContainer: () => ({ inspect: async () => ({ Config: { Cmd: command } }) }) } },
        './cpuTopology.js': { assertCpuBinding: async () => {} },
        './hostPortAvailability.js': {}, './portAllocationLock.js': {},
        '../templates/nativeContract.js': nativeContract,
        '../database/index.js': { serverRepository: {
            update: async (_id: number, patch: any) => { server = { ...server, ...patch }; },
            updateDockerInfo: async (_id: number, id: string) => { server.docker_container_id = id; },
            updateRuntimeState: async () => {},
        } },
        '../providers/ovhcloud/adapters/registry.js': {},
        '../utils/portPolicy.js': { assertPortPolicy: () => {} },
        '../utils/storage.js': { ensureServerMountDirs: async () => [] },
        '../utils/docker.js': {
            checkContainerStatus: async () => 'running', imageExists: async () => true,
            stopContainer: async () => {}, removeContainer: async () => {},
            createContainer: async (spec: any) => { count++; created = spec; command = spec.native.command; return { id: 'after', name: 'ffa' }; },
            inspectContainerRuntime: async () => ({ healthStatus: 'none' }),
        },
        '../providers/runtimeConfig.js': { parseStoredPorts: () => ports, parseStoredMounts: () => document.mounts, parseStoredEnv: () => env, parseStoredHealthcheck: () => null, parseStoredResourceLimits: () => ({ cpus: 1 }), getRuntimeOwnership: () => ({ uid: 1000, gid: 1000 }) },
        './serverTransitions.js': { beginServerTransition: async () => {}, completeServerTransition: async () => {}, clearServerTransition: () => {} },
        './servers.js': { getServerOrThrow: async () => server },
        './ovhcloudLifecycle.js': { getServerStopTimeoutSeconds: () => 30, getServerRestartPolicy: () => 'unless-stopped', recreateOvhcloudServerIfHandled: async () => ({ handled: false }) },
        './serverActionPolicy.js': { assertCanReconfigureContainer: () => {}, assertCanReconfigureServer: () => {} },
    });
    const result = await module.refreshNativeStartupCompatibility(7);
    assert.equal(result.wasRunning, true);
    assert.equal(count, 1);
    assert.equal(server.name, 'FFA');
    assert.deepEqual(JSON.parse(server.provider_metadata_json).pendingConfiguration, pending);
    assert.equal(created.resourceLimits.cpus, 1);
    assert(created.env.includes('MAP=de_dust2'));
    assert(!created.native.command[2].includes('SERVER_NAME'));
    assert.equal(await module.refreshNativeStartupCompatibility(7), null);
    assert.equal(count, 1);
});
