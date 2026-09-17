import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as crypto from 'node:crypto';
import * as stream from 'node:stream';
import { loadWithMocks } from './loadWithMocks.js';
import { buildPortMaps } from '../src/utils/docker/portBindings.js';
import * as portPolicy from '../src/utils/portPolicy.js';
import * as ownership from '../src/utils/docker/ownership.js';

test('Docker inspection retains HostIp and respects edited-container exclusions', async () => {
    const module = loadWithMocks('../src/utils/docker/containers.ts', {
        './ownership.js': ownership,
        './portBindings.js': { buildPortMaps },
        '../portPolicy.js': portPolicy,
        './client.js': { docker: {
            listContainers: async () => [{ Id: 'other' }, { Id: 'edited' }],
            getContainer: (id: string) => ({ inspect: async () => ({
                Name: id, Config: { Labels: { 'gamepanel.managed': 'true', 'gamepanel.serverId': id === 'edited' ? '7' : '8' } },
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

test('start/restart reject disallowed saved bindings before calling Docker', async () => {
    let starts = 0, restarts = 0;
    let binding: any = { NetworkMode: 'bridge', PortBindings: { '8080/tcp': [{ HostIp: '192.0.2.10', HostPort: '8080' }] } };
    const module = loadWithMocks('../src/utils/docker/containers.ts', {
        './ownership.js': ownership,
        './portBindings.js': { buildPortMaps },
        '../portPolicy.js': { ...portPolicy, configuredPortPolicy: () => portPolicy.configuredPortPolicy('{"192.0.2.10":{"tcp":"27015"}}') },
        './client.js': { docker: { getContainer: () => ({
            inspect: async () => ({ HostConfig: binding }), start: async () => { starts++; }, restart: async () => { restarts++; },
        }) } },
        './networks.js': {}, '../../config.js': {}, 'node:crypto': crypto,
        '../logger.js': {}, '../resourceLimits.js': {}, stream,
    });
    await assert.rejects(module.startContainer('test'), /not allowed/);
    await assert.rejects(module.restartContainer('test'), /not allowed/);
    assert.equal(starts + restarts, 0);
    binding.PortBindings['8080/tcp'][0].HostPort = '27015';
    await module.startContainer('test'); await module.restartContainer('test');
    assert.equal(starts, 1); assert.equal(restarts, 1);
    binding.NetworkMode = 'host';
    await assert.rejects(module.startContainer('test'), /Host networking/);
    binding.NetworkMode = 'bridge'; binding.PublishAllPorts = true;
    await assert.rejects(module.startContainer('test'), /automatic port/);
    assert.equal(starts + restarts, 2);
});
