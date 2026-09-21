import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';
import * as startup from '../src/templates/startupCommand.js';

function setup() {
    const events: string[] = [];
    const rows: any[] = [];
    const module = loadWithMocks('../src/services/consoleLifecycle.ts', {
        '../database/index.js': {
            serverRepository: { findById: async () => ({ provider_metadata_json: '{}' }) },
            actionsRepository: {
                create: async (_id: number, _level: string, message: string) => { events.push(message); },
                getRecent: async () => rows,
            },
        },
        '../utils/docker/client.js': { docker: { getContainer: () => ({ inspect: async () => ({ Config: { Labels: { 'gamepanel.serverId': '7' }, Cmd: ['/bin/bash', '-c', 'prepare\nexec ./hlds_linux "$@"', 'hlds', '+map', 'de_dust2'], Env: [] } }) }) } },
        '../templates/startupCommand.js': startup,
        '../templates/nativeContract.js': { nativeTemplate: () => null },
        './nativeLogs.js': { redactNativeLog: (line: string, secrets: string[]) => secrets.filter(Boolean).reduce((s, v) => s.split(v).join('[REDACTED]'), line) },
        '../utils/logger.js': { logError: () => {} },
    });
    return { module, events, rows };
}

test('console shows restart, actual game argv without wrapper, and confirmed container state', async () => {
    const { module, events } = setup();
    const status = module.recordConsoleStatus(7, 'restarting');
    await module.recordDockerLifecycle(7, 'container', 'die', '0');
    await module.recordDockerLifecycle(7, 'container', 'start');
    await status;
    await module.recordConsoleStatus(7, 'running');
    assert.deepEqual(events, [
        '[GamePanel] Restarting server…', '[GamePanel] Container exited. Exit code: 0.', '[GamePanel] Container started.',
        '[GamePanel] Startup command: ./hlds_linux +map de_dust2', '[GamePanel] Container is running.',
    ]);
});

test('startup command masks template secrets, environment secrets and literal credential flags', () => {
    const { module } = setup();
    const line = module.safeStartupCommand({ Cmd: ['./srcds_run', '+sv_setsteamaccount', 'literal-token', '+rcon_password=literal-pass', '--key', 'private-value', '+map', 'de_dust2'], Env: ['OPAQUE=private-value'] }, ['OPAQUE']);
    assert.ok(line.includes('de_dust2'));
    for (const secret of ['literal-token', 'literal-pass', 'private-value']) assert.ok(!line.includes(secret));
    assert.equal(module.safeStartupCommand({ Cmd: ['/bin/bash', '-c', 'echo super-secret; exec game'] }, []), null);
    assert.equal(module.safeStartupCommand({ Cmd: ['/bin/bash', '-lc', 'echo super-secret; exec game'] }, []), null);
});

test('history interleaves lifecycle markers and Docker output without losing installer output', async () => {
    const { module, rows } = setup();
    rows.push({ timestamp: '2026-09-21T13:00:00.001Z', message: '[GamePanel] Starting container…' }, { timestamp: '2026-09-21T13:00:00.003Z', message: '[GamePanel] Container is running.' }, { timestamp: '2026-09-21T13:00:00.005Z', message: 'Unrelated private action' });
    const history = await module.consoleLogHistory(7, ['Installer output'], ['2026-09-21T13:00:00.002000001Z Game boot', '2026-09-21T13:00:00.004000001Z Steam connected']);
    assert.deepEqual(Array.from(history), ['Installer output', '2026-09-21T13:00:00.001Z [GamePanel] Starting container…', '2026-09-21T13:00:00.002000001Z Game boot', '2026-09-21T13:00:00.003Z [GamePanel] Container is running.', '2026-09-21T13:00:00.004000001Z Steam connected']);
});
