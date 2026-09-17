import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { configuredBindAddresses, normalizeBindAddress, bindingsConflict } from '../src/utils/bindAddresses.js';
import { buildAndValidateOpenPortMappings } from '../src/utils/ports.js';
import { buildPortMaps } from '../src/utils/docker/portBindings.js';
import { parseStoredPorts } from '../src/providers/runtimeConfig.js';

const previous = process.env.GAMEPANEL_BIND_IPS;
process.env.GAMEPANEL_BIND_IPS = '192.0.2.10,192.0.2.11';
after(() => { if (previous === undefined) delete process.env.GAMEPANEL_BIND_IPS; else process.env.GAMEPANEL_BIND_IPS = previous; });
const mapping = (hostIp?: string) => ({ host: 27015, container: 27015, label: 'Game', hostIp });

test('operator allowlist accepts IPv4 and removes duplicates', () => {
    assert.deepEqual(configuredBindAddresses(' 192.0.2.10,192.0.2.10,192.0.2.11 '), ['192.0.2.10', '192.0.2.11']);
    assert.deepEqual(configuredBindAddresses(''), []);
    for (const value of ['0.0.0.0', '::', '192.0.2.0/24', 'example.com', '999.1.1.1', '224.0.0.1', '192.0.2.10,']) {
        assert.throws(() => configuredBindAddresses(value));
    }
});

test('caller cannot bypass allowlist or choose arbitrary wildcards', () => {
    assert.equal(normalizeBindAddress('192.0.2.10'), '192.0.2.10');
    assert.equal(normalizeBindAddress(undefined), undefined);
    assert.equal(normalizeBindAddress(''), undefined);
    for (const value of ['192.0.2.12', '0.0.0.0', '::1', 'localhost', null, [], true, 123]) assert.throws(() => normalizeBindAddress(value));
});

test('strict port parsing rejects junk, floats and nonnumeric values', () => {
    for (const host of ['27015junk', '27015.1', 27015.1, true, null, '', 0, 65536]) {
        assert.throws(() => buildAndValidateOpenPortMappings({ portsPayload: { tcp: [{ host, container: 27015 }] } }));
    }
});

test('same protocol/port on distinct concrete IPs is allowed; overlap is rejected', () => {
    const a = mapping('192.0.2.10'), b = mapping('192.0.2.11');
    const { ports } = buildAndValidateOpenPortMappings({ portsPayload: { tcp: [a, b], udp: [a, b] } });
    assert.equal(ports.tcp.length, 2);
    assert.throws(() => buildAndValidateOpenPortMappings({ portsPayload: { tcp: [a, a] } }), /Overlapping/);
    assert.throws(() => buildAndValidateOpenPortMappings({ portsPayload: { tcp: [mapping(), b] } }), /Overlapping/);
});

test('conflicts account for wildcard/IPv6 mappings and independent protocols', () => {
    const base = { protocol: 'tcp' as const, hostPort: 27015, hostIp: '192.0.2.10' };
    assert.equal(bindingsConflict(base, { ...base, hostIp: '192.0.2.11' }), false);
    assert.equal(bindingsConflict(base, base), true);
    assert.equal(bindingsConflict(base, { ...base, protocol: 'udp' }), false);
    assert.equal(bindingsConflict(base, { ...base, hostPort: 27016 }), false);
    for (const hostIp of [undefined, '', '0.0.0.0', '::', '::ffff:192.0.2.10']) {
        assert.equal(bindingsConflict(base, { ...base, hostIp }), true);
    }
});

test('Docker payload preserves both bindings to one container port, for TCP and UDP', () => {
    const { ports } = buildAndValidateOpenPortMappings({ portsPayload: {
        tcp: [mapping('192.0.2.10'), mapping('192.0.2.11')], udp: [mapping('192.0.2.11')],
    } });
    const { portBindings, exposedPorts } = buildPortMaps(ports);
    assert.deepEqual(portBindings['27015/tcp'], [{ HostPort: '27015', HostIp: '192.0.2.10' }, { HostPort: '27015', HostIp: '192.0.2.11' }]);
    assert.deepEqual(portBindings['27015/udp'], [{ HostPort: '27015', HostIp: '192.0.2.11' }]);
    assert.deepEqual(Object.keys(exposedPorts), ['27015/tcp', '27015/udp']);
});

test('stored JSON roundtrip retains IPv4; old records retain Docker default', () => {
    const { ports } = buildAndValidateOpenPortMappings({ portsPayload: { tcp: [mapping('192.0.2.10')] } });
    const restored = parseStoredPorts({ ports_json: JSON.stringify(ports) } as any);
    assert.deepEqual(buildPortMaps(restored), buildPortMaps(ports));
    const legacy = parseStoredPorts({ ports_json: JSON.stringify({ tcp: [mapping()], udp: [] }) } as any);
    assert.deepEqual(buildPortMaps(legacy).portBindings['27015/tcp'], [{ HostPort: '27015' }]);
});
