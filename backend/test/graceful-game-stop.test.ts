import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';
import { validateTemplate, templateHash } from '../src/templates/schema.js';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';

function setup(stopCommand: string | undefined = 'quit', responds = true) {
    const events: string[] = [];
    const state = { Running: true, Restarting: false };
    const server = { id: 7, docker_container_id: 'container', provider_metadata_json: '{}', runtime_config_json: '{}' };
    let policy = { Name: 'unless-stopped' };
    const module = loadWithMocks('../src/services/gracefulGameStop.ts', {
        '../utils/docker/client.js': { docker: { getContainer: () => ({
            inspect: async () => ({ State: state, Config: { OpenStdin: true, Labels: { 'gamepanel.serverId': '7' } }, HostConfig: { RestartPolicy: policy } }),
            update: async (v: any) => { policy = v.RestartPolicy; events.push('policy:' + policy.Name); },
            stop: async () => { events.push('signal'); state.Running = false; },
        }) } },
        '../utils/docker/ownership.js': { ownsContainer: () => true },
        '../database/index.js': { serverRepository: { findById: async () => server, listAll: async () => [server] }, actionsRepository: { create: async (_id: number, _level: string, message: string) => { events.push(message); } } },
        '../database/init.js': { getDatabase: async () => ({ run: async (sql: string, value: string) => {
            if (sql.includes('json_set')) { server.runtime_config_json = JSON.stringify({ nativeGracefulStop: JSON.parse(value) }); events.push('persist'); }
            else { server.runtime_config_json = '{}'; events.push('clear'); }
        } }) },
        '../templates/nativeContract.js': { nativeTemplate: () => ({ lifecycle: { stopCommand } }) },
        './gameConsole.js': { sendGameConsoleCommand: async (_server: any, command: string) => { events.push(command); if (responds) state.Running = false; } },
        '../utils/logger.js': { logError: () => {} },
    }, { setTimeout: (callback: () => void) => { callback(); return 1; }, Date: class extends Date { static tick = 0; static now() { return this.tick += 1000; } } });
    return { module, events, server, state, policy: () => policy };
}

test('template quit stops game before any fallback signal and restores policy only on explicit start', async () => {
    const { module, events, server, policy } = setup();
    assert.equal(await module.tryGracefulGameStop('container', 30), true);
    assert.ok(events.indexOf('persist') < events.indexOf('policy:no'));
    assert.ok(events.indexOf('policy:no') < events.indexOf('quit'));
    assert.equal(events.includes('signal'), false);
    assert.equal(policy().Name, 'no');
    assert.ok(JSON.parse(server.runtime_config_json).nativeGracefulStop);
    const finish = await module.restoreGracefulRestartPolicy('container');
    assert.equal(policy().Name, 'unless-stopped');
    await finish();
    assert.deepEqual(JSON.parse(server.runtime_config_json), {});
});

test('other templates can use stop instead of quit, and absent command keeps signal-only path', async () => {
    const custom = setup('stop');
    await custom.module.tryGracefulGameStop('container', 30);
    assert.ok(custom.events.includes('stop'));
    assert.ok(!custom.events.includes('quit'));
    const absent = setup('');
    assert.equal(await absent.module.tryGracefulGameStop('container', 30), false);
    assert.equal(absent.events.length, 0);
});

test('unresponsive game receives fallback only after command and waiting', async () => {
    const { module, events } = setup('quit', false);
    await module.tryGracefulGameStop('container', 1);
    assert.ok(events.indexOf('quit') < events.indexOf('signal'));
    assert.ok(events.some(e => e.includes('did not exit in time')));
});

test('boot recovery keeps stopped games stopped and restores crash recovery for interrupted running game', async () => {
    const s = setup();
    await s.module.tryGracefulGameStop('container', 30);
    await s.module.recoverGracefulRestartPolicies();
    assert.equal(s.policy().Name, 'no');
    s.state.Running = true;
    await s.module.recoverGracefulRestartPolicies();
    assert.equal(s.policy().Name, 'unless-stopped');
    assert.deepEqual(JSON.parse(s.server.runtime_config_json), {});
});

test('optional stop command validates without changing old native snapshot hashes', () => {
    const old = structuredClone(NATIVE_CS16_TEMPLATE);
    delete old.lifecycle!.stopCommand;
    const canonical = validateTemplate(old);
    assert.equal('stopCommand' in canonical.lifecycle!, false);
    assert.equal(templateHash(canonical), templateHash(validateTemplate(canonical)));
    for (const command of ['quit', 'stop', 'shutdown now']) {
        assert.equal(validateTemplate({ ...canonical, lifecycle: { ...canonical.lifecycle, stopCommand: command } }).lifecycle!.stopCommand, command);
    }
    for (const command of ['', 'quit\nstatus', 'quit\rstatus', '{{COMMAND}}']) {
        assert.throws(() => validateTemplate({ ...canonical, lifecycle: { ...canonical.lifecycle, stopCommand: command } }));
    }
});
