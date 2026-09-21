import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';

test('managed updates require standalone opt-in, no remote nodes and a local PRO updater image', async () => {
 const env: Record<string,string> = {}; let remote: unknown[] = []; let inspected = '';
 const module = loadWithMocks('../src/services/managedUpdates.ts', {
  'node:fs/promises': {}, 'node:path': {}, '../nodes/control.js': { nodes: () => ({ list: async () => remote }) },
  '../agent/identity.js': { isAgent: () => false }, '../config.js': {},
  '../utils/docker/client.js': { docker: { getImage: (image: string) => ({ inspect: async () => { inspected = image; } }) } },
 }, { process: { env } });
 assert.equal((await module.managedUpdateCapability()).enabled, false);
 env.GAMEPANEL_MANAGED_UPDATES = 'true'; env.GAMEPANEL_PRO_UPDATER_IMAGE = 'upstream/untrusted:latest';
 assert.equal((await module.managedUpdateCapability()).enabled, false);
 env.GAMEPANEL_PRO_UPDATER_IMAGE = 'gamepanel-pro-updater:2.0.50'; remote = [{ id: 'remote' }];
 assert.equal((await module.managedUpdateCapability()).enabled, false);
 remote = []; assert.equal((await module.managedUpdateCapability()).enabled, true);
 assert.equal(inspected, 'gamepanel-pro-updater:2.0.50');
});

test('starting an update rejects previews and duplicate jobs without pulling an upstream image', async () => {
 let active = false, launched = 0; let env: string[] = [];
 const module = loadWithMocks('../src/services/panelUpdates.ts', {
  './managedUpdates.js': { managedUpdateCapability: async () => ({ enabled: true }), readManagedUpdateResult: async () => null },
  '../database/index.js': { panelUpdateJobRepository: { getRunning: async () => null, createIfNoneActive: async () => active ? null : (active = true, 1), markRunning: async () => {}, markFailed: async () => {} } },
  '../utils/appInfo.js': { getAppVersion: () => '2.0.50' },
  '../utils/docker/client.js': { docker: { createContainer: async (options: any) => { assert.equal(options.Image, 'gamepanel-pro-updater:2.0.50'); env = options.Env; return { id: 'job-container', start: async () => { launched++; } }; } } },
  '../config.js': { getConfig: () => ({ gamepanelAppRoot: '/opt/gamepanel', composeProjectName: 'gamepanel', dockerSocket: '/var/run/docker.sock' }) },
  '../utils/logger.js': {}, '../utils/time.js': {},
 }, { process: { env: { GAMEPANEL_PRO_UPDATER_IMAGE: 'gamepanel-pro-updater:2.0.50' } }, AbortSignal,
  fetch: async (url: string) => { assert.match(url, /Skoczi\/game-panel-skoczi/); return { ok: true, json: async () => [{ tag_name: 'v2.0.51' }, { tag_name: 'v2.0.52', prerelease: true }] }; } });
 await assert.rejects(module.startPanelUpdate({ version: '2.0.52', startedBy: 'admin' }), /Unknown update/);
 await module.startPanelUpdate({ version: '2.0.51', startedBy: 'admin' });
 await assert.rejects(module.startPanelUpdate({ version: '2.0.51', startedBy: 'admin' }), /already running/);
 assert.equal(launched, 1); assert(env.includes('GP_UPDATE_VERSION=2.0.51'));
});
