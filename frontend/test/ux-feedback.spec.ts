import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('gamepanel_admin_runtime', '1');
    sessionStorage.setItem('gamepanel_active_node', 'local');
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/servers/7') return route.fulfill({ json: { server: { uptimeSeconds: 101340 } } });
    if (url.pathname.endsWith('/files/roots'))
      return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (url.pathname.endsWith('/file'))
      return route.fulfill({ headers: { etag: '"fixture-version"' }, json: { content: 'hostname test', version: '"fixture-version"' } });
    if (url.pathname.endsWith('/files'))
      return route.fulfill({ json: { entries: [{ name: 'server.cfg', type: 'file' }] } });
    return route.fulfill({ json: { nodes: [], entries: [], settings: {} } });
  });
});
for (const theme of ['light', 'dark']) {
  test(`help opens with keyboard and click, escapes and fits mobile in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/test/ui-help.fixture.html');
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    const button = page.getByRole('button', { name: 'More information' });
    await button.focus();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await button.click();
    await expect(tip).toBeVisible();
    await expect(button).toHaveAttribute('aria-describedby', await tip.getAttribute('id') as string);
    const box = (await tip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(844);
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0); await expect(button).toBeFocused();
    await page.keyboard.press('Enter'); await expect(tip).toBeVisible();
    await page.keyboard.press('Tab'); await expect(tip).toHaveCount(0);
  });
}
test('backup failure never claims there are no backups', async ({ page }) => {
  await page.route('**/backups', route => route.fulfill({ status: 503, json: { error: 'Archive storage unavailable' } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await expect(page.getByRole('alert').filter({ hasText: 'Archive storage unavailable' })).toBeVisible();
  await expect(page.getByText('No backups found.')).toHaveCount(0);
});
test('schedule load error is distinct from an empty list and refresh recovers', async ({ page }) => {
  let ready = false;
  await page.route('**/scheduled-tasks', route => route.fulfill(ready ? { json: { tasks: [] } } : { status: 503, json: { error: 'Schedule unavailable' } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/scheduledtasks');
  await expect(page.getByRole('alert')).toContainText('Schedule unavailable');
  await expect(page.getByText('No scheduled tasks yet.')).toHaveCount(0);
  ready = true; await page.getByRole('button', { name: 'Refresh scheduled tasks' }).click();
  await expect(page.getByText('No scheduled tasks yet.')).toBeVisible();
});
test('failed schedule toggle retains its value and reports uncertain outcome', async ({ page }) => {
  await page.route('**/scheduled-tasks', route => route.fulfill({ json: { tasks: [{ id: 1, type: 'backup', enabled: true, schedule: '0 5 * * *', payload: {}, nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null }] } }));
  let changes = 0;
  await page.route('**/scheduled-tasks/1', route => { changes++; return route.fulfill({ status: 503, json: {} }); });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/scheduledtasks');
  const toggle = page.getByRole('switch', { name: 'Task enabled' });
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('Could not confirm the schedule change');
  await expect(toggle).toHaveAttribute('aria-checked', 'true'); expect(changes).toBe(1);
});
test('custom schedule fields have labels and keep content after rejected save', async ({ page }) => {
  await page.route('**/scheduled-tasks', route => route.fulfill(route.request().method() === 'GET' ? { json: { tasks: [] } } : { status: 400, json: { error: 'Rejected schedule' } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/scheduledtasks');
  await page.getByRole('button', { name: 'Add Task', exact: true }).click();
  await page.getByRole('button', { name: 'Container shell command', exact: true }).click();
  await page.getByLabel('Command', { exact: false }).fill('echo test');
  await page.getByLabel('Working directory', { exact: false }).fill('/data');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByRole('alert')).toContainText('Rejected schedule');
  await expect(page.getByLabel('Working directory', { exact: false })).toHaveValue('/data');
});
test('file browser distinguishes empty folders from hidden files and read errors', async ({ page }) => {
  let mode = 'empty';
  await page.route('**/files?**', route => route.fulfill(mode === 'error' ? { status: 503, json: { error: 'Cannot read directory' } } : { json: { entries: mode === 'hidden' ? [{ name: '.env', type: 'file' }] : [] } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await expect(page.getByText('This folder is empty.')).toBeVisible();
  mode = 'hidden'; await page.reload();
  await expect(page.getByText(/Only hidden files are here/)).toBeVisible();
  mode = 'error'; await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Cannot read directory' })).toBeVisible();
  await expect(page.getByText('This folder is empty.')).toHaveCount(0);
});

const protection = {
  measuredAt: '2026-09-21T12:00:00Z', gameAllocatedBytes: 1048576, archiveBytes: 2097152,
  recoveryAllocatedBytes: 3145728, recoveryCount: 1, nodeFreeBytes: 1073741824,
  archiveCount: 2, unverifiedCount: 1, warnings: [], schedules: { total: 1, enabled: 0, nextRunAt: null, lastProblem: 0 },
  restoreHistoryAvailable: true, lastRestore: null,
  latestBackup: { name: 'before-update.tar.gz', createdAt: '2026-09-21T11:00:00Z', validatedAt: '2026-09-21T11:01:00Z', mode: 'live', sizeBytes: 1024 },
};
for (const theme of ['light', 'dark']) {
  test(`protection distinguishes archive validation, restore and missing schedules on mobile in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, layoutReady: true, legacy: [], recoveryCount: 1, capabilities: { nativeProtection: 1, backupJobs: 1, nativeRestoreRecovery: 1 } } }));
    await page.route('**/backups/protection', route => route.fulfill({ json: protection }));
    await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    await page.getByText('Storage & backup details', { exact: true }).click();
    const card = page.getByRole('region', { name: 'Data protection', exact: true });
    await expect(card).toContainText('before-update.tar.gz');
    await expect(card).toContainText('Structure checked');
    await expect(card).toContainText('No enabled backup schedule.');
    await expect(card).toContainText('No restore recorded');
    await expect(card).toContainText('3 MiB');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
test('protection scan fails explicitly and refresh does not mutate backups', async ({ page }) => {
  let ready = false; let mutations = 0;
  await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, layoutReady: true, legacy: [], recoveryCount: 0, capabilities: { nativeProtection: 1 } } }));
  await page.route('**/backups/protection', route => {
    if (route.request().method() !== 'GET') mutations++;
    return route.fulfill(ready ? { json: { ...protection, latestBackup: null, gameAllocatedBytes: null, schedules: null, lastRestore: { status: 'failed', startedAt: '2026-09-21T12:00:00Z', completedAt: null } } } : { status: 503, json: { error: 'Storage scan unavailable' } });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await page.getByText('Storage & backup details', { exact: true }).click();
  const card = page.getByRole('region', { name: 'Data protection', exact: true });
  await expect(card.getByRole('alert')).toContainText('Storage scan unavailable');
  ready = true; await card.getByRole('button', { name: 'Refresh storage' }).click();
  await expect(card).toContainText('No verified backup recorded');
  await expect(card).toContainText('No data');
  await expect(card).toContainText('Schedule status unavailable.');
  await expect(card).toContainText('failed');
  expect(mutations).toBe(0);
});

test('cleanup previews first, requires typed confirmation and rejects a stale plan without retrying', async ({ page }) => {
  const plan = { fingerprint: 'a'.repeat(64), policy: { keepArchives: 5, keepRecovery: 2 }, remove: [{ name: 'old.tar.gz', kind: 'archive', sizeBytes: 1024, modifiedAt: '2026-01-01T00:00:00Z', protectedReason: null }], keep: [{ name: 'latest.tar.gz', kind: 'archive', sizeBytes: 1024, modifiedAt: '2026-09-21T00:00:00Z', protectedReason: 'Kept by retention policy' }] };
  let writes = 0;
  await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, layoutReady: true, legacy: [], recoveryCount: 0, capabilities: { nativeRetention: 1 } } }));
  await page.route('**/backups/retention**', route => {
    if (route.request().method() === 'POST') { writes++; expect(route.request().postDataJSON()).toEqual({ ...plan.policy, fingerprint: plan.fingerprint }); return route.fulfill({ status: 409, json: { error: 'Backup storage changed since the preview. Refresh the cleanup plan.' } }); }
    return route.fulfill({ json: plan });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await page.getByText('Clean up backups', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview cleanup' }).click();
  await expect(page.getByRole('region', { name: 'Cleanup preview' })).toContainText('old.tar.gz');
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Review deletion' }).click();
  const dialog = page.getByRole('dialog');
  const remove = dialog.getByRole('button', { name: 'Delete reviewed items' });
  await expect(remove).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Review deletion' }).click();
  await dialog.getByLabel('Type "DELETE" to confirm').fill('DELETE');
  await remove.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Backup storage changed since the preview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review deletion' })).toHaveCount(0); expect(writes).toBe(1);
});
test('changing cleanup rules invalidates the displayed preview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, layoutReady: true, legacy: [], recoveryCount: 0, capabilities: { nativeRetention: 1 } } }));
  await page.route('**/backups/retention**', route => route.fulfill({ json: { fingerprint: 'a'.repeat(64), policy: { keepArchives: 5, keepRecovery: 2 }, remove: [], keep: [] } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await page.getByText('Clean up backups', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview cleanup' }).click();
  await expect(page.getByRole('region', { name: 'Cleanup preview' })).toBeVisible();
  await page.getByLabel('Backups to keep', { exact: true }).fill('0');
  await expect(page.getByRole('region', { name: 'Cleanup preview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview cleanup' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('historical content stages locally and overwrites only on explicit Save', async ({ page }) => {
  let remote = 'hostname current'; let version = '"v1"'; let writes = 0; let attempts = 0;
  const entry = { id: 'entry-1', actor: 'historian', state: 'committed', createdAt: '2026-09-21T10:00:00Z', beforeVersion: '"old"', afterVersion: '"later"', before: 'hostname historical', after: 'hostname later' };
  await page.route('**/file/history?**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('entry') ? { entry } : { entries: [entry] } }));
  await page.route('**/file?**', route => {
    if (route.request().method() === 'PUT') {
      attempts++; const body = route.request().postDataJSON();
      if (!body.overwrite && body.version !== version) return route.fulfill({ status: 409, json: { error: 'File changed since it was opened' } });
      writes++; remote = body.content; version = '"v3"'; return route.fulfill({ json: { ok: true, version } });
    }
    return route.fulfill({ headers: { etag: version }, body: remote });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('server.cfg', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'File history', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /historian/ }).click();
  await expect(dialog.locator('.monaco-diff-editor')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use previous version in editor' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.monaco-editor:visible')).toContainText('hostname historical');
  expect(attempts).toBe(0);
  remote = 'hostname external'; version = '"v2"';
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => writes).toBe(1); expect(remote).toBe('hostname historical');
});
for (const theme of ['light', 'dark']) {
  test(`history comparison fits mobile and cancelling preserves the unsaved draft in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
    const entry = { id: 'entry-1', actor: 'historian', state: 'prepared', createdAt: '2026-09-21T10:00:00Z', beforeVersion: '"old"', afterVersion: '"later"', before: 'hostname historical', after: 'hostname later' };
    await page.route('**/file/history?**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('entry') ? { entry } : { entries: [entry] } }));
    await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
    await page.getByText('server.cfg', { exact: true }).dblclick();
    await page.locator('.monaco-editor:visible').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('hostname unsaved');
    await page.getByRole('button', { name: 'File history', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: /historian/ }).click();
    await expect(dialog).toContainText('proposed text (save not confirmed)');
    await expect(dialog.locator('.monaco-diff-editor')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Use previous version in editor' }).click();
    const confirm = page.getByRole('dialog', { name: 'Replace current draft?' });
    await expect(confirm).toBeVisible(); await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.monaco-editor:visible')).toContainText('hostname unsaved');
  });
}

for (const theme of ['light', 'dark']) test(`backup fields and empty history have usable spacing in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, layoutReady: true, legacy: [], recoveryCount: 0, capabilities: { backupJobs: 1, nativeRestoreRecovery: 1 } } }));
  await page.route('**/backups/jobs', route => route.fulfill({ json: { jobs: [] } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
  await page.getByRole('button', { name: 'Create backup now' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create backup' });
  const input = dialog.getByLabel('Backup name (optional)');
  const label = dialog.locator('label').filter({ hasText: 'Backup name (optional)' });
  await expect(input).toBeVisible();
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(36);
  const box = (await input.boundingBox())!;
  const labelBox = (await label.boundingBox())!;
  expect(box.y).toBeGreaterThan(labelBox.y + labelBox.height);
  expect(box.height).toBeGreaterThanOrEqual(36);
  expect(await input.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('solid');
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await dialog.screenshot({ path: `test-results/backup-form-${theme}.png` });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.route('**/file/history?**', route => route.fulfill({ json: { entries: [] } }));
  await page.getByRole('link', { name: 'File Editor', exact: true }).click();
  await page.getByText('server.cfg', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'File history', exact: true }).click();
  const history = page.getByRole('dialog');
  await expect(history.getByText('No saved versions yet.')).toBeVisible();
  const heading = await history.getByRole('heading').boundingBox();
  const modalBox = (await history.boundingBox())!;
  expect(heading!.x - modalBox.x).toBeGreaterThanOrEqual(16);
  expect(heading!.y - modalBox.y).toBeGreaterThanOrEqual(16);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await history.screenshot({ path: `test-results/file-history-empty-${theme}.png` });
});
