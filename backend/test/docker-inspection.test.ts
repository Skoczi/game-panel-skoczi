import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as crypto from 'node:crypto';
import * as stream from 'node:stream';
import { loadWithMocks } from './loadWithMocks.js';
import { buildPortMaps } from '../src/utils/docker/portBindings.js';

test('Docker inspection retains HostIp and respects edited-container exclusions', async () => {
    const module = loadWithMocks('../src/utils/docker/containers.ts', {
        './portBindings.js': { buildPortMaps },
        './client.js': { docker: {
            listContainers: async () => [{ Id: 'other' }, { Id: 'edited' }],
            getContainer: (id: string) => ({ inspect: async () => ({
                Name: id, Config: { Labels: { 'gamepanel.serverId': id === 'edited' ? '7' : '8' } },
                HostConfig: { PortBindings: { '27015/udp': [
                    { HostIp: '192.0.2.10', HostPort: '27015' },
                    { HostIp: '192.0.2.11', HostPort: '27015' },
                ] } },
            }) }),
        } },
        './networks.js': {}, '../../config.js': {}, 'node:crypto': crypto,
        '../logger.js': {}, '../resourceLimits.js': {}, stream,
    });
    const records = await module.listPublishedHostPorts({ excludeServerIds: [7] });
    assert.equal(records.length, 2);
    assert.equal(records[0].hostIp, '192.0.2.10');
    assert.equal(records[1].hostIp, '192.0.2.11');
    assert.equal(records[0].protocol, 'udp');
    assert.equal((await module.listPublishedHostPorts({ excludeContainerIds: ['other', 'edited'] })).length, 0);
});
