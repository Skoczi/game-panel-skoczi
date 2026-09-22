import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { loadWithMocks } from './loadWithMocks.js';
import * as policy from '../src/utils/portPolicy.js';
import * as addresses from '../src/utils/bindAddresses.js';
import * as schema from '../src/templates/schema.js';
import * as lock from '../src/services/portAllocationLock.js';
import { parseStoredPorts } from '../src/providers/runtimeConfig.js';

const network = { restrictPorts: false, allocations: [{ ip: '192.0.2.10', alias: '', tcp: '27015-27020', udp: '27015-27020,27018' }, { ip: '192.0.2.11', alias: '', tcp: '', udp: '27015' }] };
const allocation = loadWithMocks('../src/services/templatePortAllocation.ts', {
    '../utils/portPolicy.js': policy, '../utils/bindAddresses.js': addresses,
    './globalSettings.js': { globalSettings: () => ({ snapshot: () => ({ network }) }) },
    './hostPortAvailability.js': { reservedHostBindings: async () => [] }, '../templates/schema.js': schema,
});
test('free pools enforce address, protocol, ranges, wildcards and known reservations even in legacy mode', () => {
    const occupied = [
        { protocol: 'udp', hostPort: 27015, hostIp: '192.0.2.10' },
        { protocol: 'udp', hostPort: 27016, hostIp: '0.0.0.0' },
        { protocol: 'udp', hostPort: 27017, hostIp: '::' },
        { protocol: 'udp', hostPort: 27018, hostIp: '192.0.2.11' },
    ];
    assert.deepEqual(Array.from(allocation.availablePublicPorts(network, occupied, '192.0.2.10', 'udp')), [27018, 27019, 27020]);
    assert.equal(allocation.availablePublicPorts(network, occupied, '192.0.2.10', 'tcp').length, 6);
    assert.equal(allocation.availablePublicPorts(network, occupied, '192.0.2.11', 'tcp').length, 0);
    assert.throws(() => allocation.availablePublicPorts(network, [], '192.0.2.12', 'udp'), /not allocated/);
    assert.throws(() => allocation.availablePublicPorts(network, [], '192.0.2.10', 'sctp'), /TCP or UDP/);
});
test('automatic assignment preserves explicit fields, separates protocols, and does not duplicate claims', () => {
    const template = { ports: [{ key: 'game', protocol: 'udp' }, { key: 'query', protocol: 'udp' }, { key: 'rcon', protocol: 'tcp' }] };
    const bindings = [{ key: 'game', hostIp: '192.0.2.10', host: 'auto' }, { key: 'query', hostIp: '192.0.2.10', host: 27015 }, { key: 'rcon', hostIp: '192.0.2.10', host: 'auto' }];
    const result = allocation.chooseTemplateBindings(template, bindings, network, []);
    assert.deepEqual(Array.from(result, (b: any) => b.host), [27016, 27015, 27015]);
    assert.equal(bindings[0].host, 'auto');
    assert.throws(() => allocation.chooseTemplateBindings(template, bindings.map(b => ({ ...b, host: 27015 })), network, []), (e: any) => e.statusCode === 409);
    assert.throws(() => allocation.chooseTemplateBindings({ ports: [template.ports[0]] }, [bindings[0]], { ...network, allocations: [{ ...network.allocations[0], udp: '' }] }, []), (e: any) => e.statusCode === 409);
    assert.throws(() => allocation.chooseTemplateBindings(template, [bindings[0], bindings[0], bindings[2]], network, []), /Invalid template binding/);
});
test('inventory includes stopped saved servers and foreign Docker containers; failures do not report free ports', async () => {
    const inventory = (fail = false) => loadWithMocks('../src/services/hostPortAvailability.ts', {
        '../utils/bindAddresses.js': addresses, '../providers/runtimeConfig.js': { parseStoredPorts },
        '../database/index.js': { serverRepository: { listAll: async () => [{ id: 1, status: 'stopped', ports_json: JSON.stringify({ tcp: [], udp: [{ host: 27015, container: 27015, hostIp: '192.0.2.10' }] }) }] } },
        '../utils/docker.js': { listPublishedHostPorts: async () => { if (fail) throw new Error('Docker unavailable'); return [{ protocol: 'udp', hostPort: 27016, hostIp: '' }]; } },
    });
    const reserved = await inventory().reservedHostBindings();
    assert.equal(reserved.length, 2);
    assert.deepEqual(Array.from(allocation.availablePublicPorts(network, reserved, '192.0.2.10', 'udp')), [27017, 27018, 27019, 27020]);
    await assert.rejects(inventory(true).reservedHostBindings(), /Docker unavailable/);
});
test('allocation mutation lock rejects overlapping writes and releases idempotently after failure', () => {
    const release = lock.enterPortAllocationMutation();
    try { assert.throws(() => lock.enterPortAllocationMutation(), (e: any) => e.statusCode === 409); } finally { release(); }
    const next = lock.enterPortAllocationMutation(); release();
    assert.throws(() => lock.enterPortAllocationMutation()); next();
    lock.enterPortAllocationMutation()();
});
test('available-port route is administrator-only and returns uncached runtime inventory', async () => {
    const { rootOnly } = loadWithMocks('../src/middleware/auth.ts', { '../agent/identity.js': {}, '../utils/auth.js': {}, '../database/index.js': {}, '../utils/ids.js': {}, '../utils/logger.js': {}, '../permissions.js': {} });
    const module = loadWithMocks('../src/routes/servers/availablePorts.ts', {
        express, '../../middleware/auth.js': { rootOnly }, '../../services/templatePortAllocation.js': allocation,
        '../../utils/routeErrors.js': { sendRouteError: (res: any, e: any) => res.status(e.statusCode || 500).json({ error: e.message }) },
    }, { Date });
    const app = express(); app.use((req: any, _res, next) => { req.user = { isRoot: req.headers['x-root'] === 'yes' }; next(); }); app.use(module.createAvailablePortRoutes());
    const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/available-ports?ip=192.0.2.10&protocol=udp`;
    try {
        assert.equal((await fetch(url)).status, 403);
        const response = await fetch(url, { headers: { 'x-root': 'yes' } });
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual((await response.json()).ports, [27015, 27016, 27017, 27018, 27019, 27020]);
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
