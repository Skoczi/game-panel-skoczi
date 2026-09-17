import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWithMocks } from './loadWithMocks.js';
import * as bindings from '../src/utils/bindAddresses.js';
import { parseStoredPorts } from '../src/providers/runtimeConfig.js';

const ports = (hostIp?: string) => ({ tcp: [{ host: 27015, container: 27015, label: 'game', hostIp }], udp: [] });
function checker(servers: unknown[] = [], published: unknown[] = []) {
    return loadWithMocks('../src/services/hostPortAvailability.ts', {
        '../utils/bindAddresses.js': bindings,
        '../database/index.js': { serverRepository: { listAll: async () => servers } },
        '../providers/runtimeConfig.js': { parseStoredPorts },
        '../utils/docker.js': { listPublishedHostPorts: async () => published },
    }).assertHostPortsAvailableForServer;
}
test('database allocations reserve address + port, including stopped servers', async () => {
    const check = checker([{ id: 1, name: 'Existing', ports_json: JSON.stringify(ports('192.0.2.10')) }]);
    await check({ ports: ports('192.0.2.11') });
    await assert.rejects(check({ ports: ports('192.0.2.10') }), (error: any) => error.statusCode === 409);
    await assert.rejects(check({ ports: ports() }));
    await check({ ports: ports('192.0.2.10'), excludeServerId: 1 });
});
test('other Docker containers use HostIp, not a global port-only reservation', async () => {
    const check = checker([], [{ protocol: 'tcp', hostPort: 27015, hostIp: '192.0.2.10', containerName: 'Existing' }]);
    await check({ ports: ports('192.0.2.11') });
    await assert.rejects(check({ ports: ports('192.0.2.10') }), (error: any) => error.statusCode === 409);
    await assert.rejects(checker([], [{ protocol: 'tcp', hostPort: 27015, hostIp: '0.0.0.0' }])({ ports: ports('192.0.2.11') }));
});
