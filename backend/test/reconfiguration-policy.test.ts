import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWithMocks } from './loadWithMocks.js';
import { assertPortPolicy, configuredPortPolicy } from '../src/utils/portPolicy.js';

test('tightened policy blocks recreation before touching a running container or its files', async () => {
    const calls: string[] = [];
    const mark = (name: string) => async () => { calls.push(name); };
    const policy = configuredPortPolicy('{"192.0.2.10":{"tcp":"27015-27030"}}');
    const module = loadWithMocks('../src/services/serverReconfiguration.ts', {
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
