import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';
import * as nativeContract from '../src/templates/nativeContract.js';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';
import { templateHash } from '../src/templates/schema.js';

function fixture() {
 const calls: string[] = [];
 const template = structuredClone(NATIVE_CS16_TEMPLATE);
 let server: any = { id: 7, name: 'Test', provider: 'external', docker_container_id: 'old', docker_container_name: 'test', docker_image: 'test-image', provider_metadata_json: JSON.stringify({ template: { document: template, hash: templateHash(template) } }), ports_json: JSON.stringify({ tcp: [], udp: [{ host: 27050, container: 27015, hostIp: '192.0.2.1', label: 'Game' }] }), env_json: JSON.stringify(['SERVER_PORT=27015', 'MAP=de_dust', 'MAX_PLAYERS=16']), mounts_json: JSON.stringify(template.mounts) };
 const mark = (name: string, result?: any) => async () => { calls.push(name); return result; };
 const mod = loadWithMocks('../src/services/serverReconfiguration.ts', {
  './hostPortAvailability.js': { assertHostPortsAvailableForServer: mark('check-ports') }, './portAllocationLock.js': { enterPortAllocationMutation: () => () => {} },
  '../templates/nativeContract.js': nativeContract,
  '../database/index.js': { serverRepository: { update: async (_: any, patch: any) => { calls.push('save'); server = { ...server, ...patch }; }, updateDockerInfo: async (_: any, id: string) => { server.docker_container_id=id; }, updateRuntimeState: mark('runtime'), markFailed: mark('failed') } },
  '../providers/ovhcloud/adapters/registry.js': {}, '../utils/portPolicy.js': { assertPortPolicy: () => {} },
  '../utils/storage.js': { ensureServerMountDirs: mark('mounts', []), removeServerMountDir: mark('remove-files') },
  '../utils/docker.js': { checkContainerStatus: async () => 'running', stopContainer: mark('stop'), imageExists: async () => true, removeContainer: mark('remove'), createContainer: async (options: any) => { calls.push('recreate'); assert(options.native.command.includes('de_dust2')); assert.deepEqual(options.native.command.slice(-2), ['+sv_lan', '0']); return { id: 'new', name: 'test' }; }, inspectContainerRuntime: async () => ({ healthStatus: 'healthy' }) },
  '../providers/runtimeConfig.js': { parseStoredPorts: (s: any) => JSON.parse(s.ports_json), parseStoredEnv: (s: any) => JSON.parse(s.env_json), parseStoredMounts: (s: any) => JSON.parse(s.mounts_json), parseStoredHealthcheck: () => null, parseStoredResourceLimits: () => null, getRuntimeOwnership: () => ({ uid: 1000, gid: 1000 }) },
  './serverTransitions.js': { beginServerTransition: mark('transition'), completeServerTransition: mark('complete'), clearServerTransition: () => {} },
  './servers.js': { getServerOrThrow: async () => server },
  './ovhcloudLifecycle.js': { getServerStopTimeoutSeconds: () => 10, getServerRestartPolicy: () => 'unless-stopped', recreateOvhcloudServerIfHandled: async () => ({ handled: false }) },
  './serverActionPolicy.js': { assertCanReconfigureContainer: () => {}, assertCanReconfigureServer: () => {} },
 });
 return { mod, calls, server: () => server };
}
test('save without restart stores a durable draft without changing the live config or Docker', async () => {
 const f = fixture();
 const before = f.server().env_json;
 const result = await f.mod.reconfigureServerContainer(7, { applyMode: 'defer', customParams: ['+sv_lan', '0'], hasCustomParamsPatch: true, env: ['SERVER_PORT=27015', 'MAP=de_dust2', 'MAX_PLAYERS=24'] });
 assert.equal(result.pendingRestart, true);
 assert.deepEqual(f.calls, ['save']);
 assert.equal(f.server().env_json, before);
 assert(JSON.parse(f.server().provider_metadata_json).pendingConfiguration.env.includes('MAP=de_dust2'));
 await f.mod.applyPendingServerConfiguration(7);
 assert(f.calls.includes('check-ports')); assert(f.calls.includes('recreate'));
 assert(JSON.parse(f.server().env_json).includes('MAP=de_dust2'));
 assert.equal(JSON.parse(f.server().provider_metadata_json).pendingConfiguration, undefined);
 assert.equal(await f.mod.applyPendingServerConfiguration(7), null);
});
test('invalid deferred settings fail without writes or lifecycle changes', async () => {
 const f = fixture();
 await assert.rejects(f.mod.reconfigureServerContainer(7, { applyMode: 'defer', env: ['BOGUS=1'] }));
 assert.deepEqual(f.calls, []);
});
test('both live and deferred ports remain reserved, excluding the owning server', async () => {
 const ports = (host: number) => ({ tcp: [], udp: [{ host, container: 27015, hostIp: '192.0.2.1', label: 'Game' }] });
 const row = { id: 7, name: 'Test', ports_json: JSON.stringify(ports(27050)), provider_metadata_json: JSON.stringify({ pendingConfiguration: { ports: ports(27051) } }) };
 const { bindingsConflict } = await import('../src/utils/bindAddresses.js');
 const mod = loadWithMocks('../src/services/hostPortAvailability.ts', {
  '../utils/bindAddresses.js': { bindingsConflict }, '../database/index.js': { serverRepository: { listAll: async () => [row] } },
  '../providers/runtimeConfig.js': { parseStoredPorts: (s: any) => JSON.parse(s.ports_json) }, '../utils/docker.js': { listPublishedHostPorts: async () => [] },
 });
 assert.deepEqual(Array.from(await mod.reservedHostBindings(), (p: any) => p.hostPort), [27050, 27051]);
 await assert.rejects(mod.assertHostPortsAvailableForServer({ ports: ports(27051) }), /overlaps/);
 await mod.assertHostPortsAvailableForServer({ ports: ports(27051), excludeServerId: 7 });
 assert.equal((await mod.reservedHostBindings(7)).length, 0);
});
