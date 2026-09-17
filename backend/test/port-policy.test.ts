import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { configuredPortPolicy, assertPortPolicy } from '../src/utils/portPolicy.js';
import { configuredBindAddresses } from '../src/utils/bindAddresses.js';
import { buildAndValidateOpenPortMappings } from '../src/utils/ports.js';
import { buildPortMaps } from '../src/utils/docker/portBindings.js';

const previous = process.env.GAMEPANEL_IP_PORTS;
const raw = JSON.stringify({ '192.0.2.10': { tcp: '27015-27030,28015', udp: '27015' }, '192.0.2.11': { udp: '28015-28020' } });
after(() => { if (previous === undefined) delete process.env.GAMEPANEL_IP_PORTS; else process.env.GAMEPANEL_IP_PORTS = previous; });
const ports = (host = 27015, hostIp: string | undefined = '192.0.2.10') => ({ tcp: [{ host, hostIp, container: 8080, label: '' }], udp: [] });

test('parse inclusive ranges and independent protocol/IP allocations', () => {
    const policy = configuredPortPolicy(raw)!;
    assert.deepEqual(policy['192.0.2.10'].tcp, [{ from: 27015, to: 27030 }, { from: 28015, to: 28015 }]);
    assert.deepEqual(policy['192.0.2.11'].tcp, []);
    for (const port of [27015, 27030, 28015]) assert.doesNotThrow(() => assertPortPolicy(ports(port), policy));
    for (const port of [8080, 27014, 27031, 28016, NaN, 27015.1]) assert.throws(() => assertPortPolicy(ports(port), policy));
    assert.throws(() => assertPortPolicy(ports(28015, '192.0.2.11'), policy));
    assert.doesNotThrow(() => assertPortPolicy({ tcp: [], udp: ports(28020, '192.0.2.11').tcp }, policy));
    assert.throws(() => assertPortPolicy({ tcp: [], udp: ports(27016).tcp }, policy));
});

test('malformed configuration fails closed', () => {
    for (const value of ['oops', 'null', '[]', 'true', '{"0.0.0.0":{}}', '{"::1":{}}', '{"224.0.0.1":{}}',
        ...[null, [], { sctp: '27015' }, { tcp: 27015 }, { tcp: true }, { tcp: '8080junk' }, { tcp: '1-65535' },
            { tcp: '27030-27015' }, { tcp: '27015,' }, { tcp: '65536' }, { udp: '27015.1' }].map((rules) => JSON.stringify({ '192.0.2.10': rules }))]) {
        assert.throws(() => configuredPortPolicy(value), value);
    }
    assert.equal(configuredPortPolicy(''), null);
    assert.deepEqual(configuredPortPolicy('{}'), {});
    assert.throws(() => assertPortPolicy(ports(), {}));
});

test('API mappings and Docker recreation both enforce policy; container port remains independent', () => {
    process.env.GAMEPANEL_IP_PORTS = raw;
    assert.deepEqual(configuredBindAddresses(), ['192.0.2.10', '192.0.2.11']);
    assert.equal(buildAndValidateOpenPortMappings({ portsPayload: ports() }).ports.tcp[0].container, 8080);
    assert.equal(buildPortMaps(ports()).portBindings['8080/tcp'][0].HostPort, '27015');
    for (const bad of [ports(8080), ports(27015, ''), ports(27015, '0.0.0.0'), ports(27015, '::'), ports(27015, '192.0.2.99'),
        { tcp: [{ host: 27015, container: 8080, label: '' }], udp: [] }]) {
        assert.throws(() => buildAndValidateOpenPortMappings({ portsPayload: bad }));
        assert.throws(() => buildPortMaps(bad));
    }
    process.env.GAMEPANEL_IP_PORTS = 'broken';
    assert.throws(() => buildPortMaps(ports()));
    delete process.env.GAMEPANEL_IP_PORTS;
    assert.doesNotThrow(() => buildPortMaps({ tcp: [{ host: 8080, container: 8080, label: '' }], udp: [] }));
});
