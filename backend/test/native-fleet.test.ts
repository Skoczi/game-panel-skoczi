import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetDisplayIdentity } from '../src/fleet/displayIdentity.js';
test('native fleet identity uses the template name without changing runtime provider metadata', () => {
    const metadata = { template: { document: { schemaVersion: 2, name: 'CS 1.6 · ReHLDS' } } };
    const before = JSON.stringify(metadata);
    const expected = { provider: 'native', catalogId: 'CS 1.6 · ReHLDS' };
    assert.deepEqual(fleetDisplayIdentity('external', null, metadata), expected);
    assert.deepEqual(fleetDisplayIdentity('external', null, before), expected);
    assert.equal(JSON.stringify(metadata), before);
    assert.deepEqual(fleetDisplayIdentity('external', null, '{}'), { provider: 'external', catalogId: null });
    assert.deepEqual(fleetDisplayIdentity('linuxgsm', 'cs', 'invalid'), { provider: 'linuxgsm', catalogId: 'cs' });
});
