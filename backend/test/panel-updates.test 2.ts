import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';
function updater(releases: any[], ok = true) {
 return loadWithMocks('../src/services/panelUpdates.ts', {
  './managedUpdates.js': { managedUpdateCapability: async () => ({ enabled: false, reason: 'Manual installation' }) }, '../database/index.js': {}, '../utils/appInfo.js': { getAppVersion: () => '2.0.49' }, '../utils/docker/client.js': {}, '../utils/docker/containers.js': {}, '../config.js': {}, '../utils/logger.js': {}, '../utils/time.js': {},
 }, { AbortSignal, fetch: async () => ({ ok, status: ok ? 200 : 503, json: async () => releases }) });
}
test('release checks compare the fork semver and exclude drafts and preview releases', async () => {
 const module = updater([{ tag_name: 'v1.5.0-skoczi.49' }, { tag_name: 'v2.0.50' }, { tag_name: 'v3.0.0', prerelease: true }, { tag_name: 'v4.0.0', draft: true }]);
 const result = await module.checkPanelUpdate();
 assert.equal(result.currentVersion, '2.0.49'); assert.equal(result.latestVersion, '2.0.50'); assert.equal(result.updateAvailable, true);
 assert.equal(result.newerReleases.length, 1);
});
test('missing releases and GitHub errors never provide false version confirmation', async () => {
 assert.equal((await updater([]).checkPanelUpdate()).latestVersion, null);
 await assert.rejects(updater([], false).checkPanelUpdate(), /Unable to fetch/);
});
