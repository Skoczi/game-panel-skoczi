import { test, expect, type Page } from '@playwright/test';
import { cs16GameConfig } from '../../backend/src/templates/gameConfig';
const original = '// My settings\r\nhostname "Puszka Pandory [FFA] @eserv.pl" // keep\r\nmp_timelimit 20\r\nmp_friendlyfire 0\r\nsv_password "private-password"\r\nsv_custom 99\r\n';
async function mock(page: Page, options: { conflict?: boolean; version?: boolean; content?: string; failure?: boolean; path?: string; etag?: string } = {}) {
  let content = options.content ?? original;
  const writes: any[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/game-config')) return route.fulfill({ json: { definition: { ...cs16GameConfig(), path: options.path || cs16GameConfig().path } } });
    if (url.pathname.endsWith('/file')) {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON(); writes.push({ ...body, path: url.searchParams.get('path') });
        if (options.conflict) return route.fulfill({ status: 409, json: { error: 'Conflict' } });
        content = body.content;
        return route.fulfill({ json: { ok: true, version: '"next-version"' } });
      }
      if (options.failure) return route.fulfill({ status: 404, json: { error: 'Missing' } });
      return route.fulfill({ body: content, contentType: 'text/plain; charset=utf-8', headers: options.version === false ? {} : { ETag: options.etag || '"original-version"' } });
    }
    return route.fulfill({ json: {} });
  });
  return writes;
}
test('saves reviewed changes with file version, preserves comments and masks passwords', async ({ page }) => {
  const writes = await mock(page);
  await page.goto('/test/native-game-config.fixture.html');
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Puszka Pandory [FFA] @eserv.pl');
  await page.getByLabel('Server name', { exact: true }).fill('Puszka Pandory [COD MOD] @eserv.pl');
  await page.getByLabel('Map time limit', { exact: true }).fill('35');
  await page.getByLabel('Join password', { exact: true }).fill('new-private-password');
  await expect(page.getByLabel('Unsaved configuration')).toHaveText('true');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review configuration changes' });
  await expect(review).toContainText('Puszka Pandory [COD MOD]');
  await expect(review).not.toContainText('private-password');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText(/Configuration saved/)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].version).toBe('"original-version"');
  expect(writes[0].overwrite).toBeUndefined();
  expect(writes[0].content).toBe(original.replace('[FFA]', '[COD MOD]').replace('mp_timelimit 20', 'mp_timelimit "35"').replace('private-password', 'new-private-password'));
  await expect(page.getByLabel('Unsaved configuration')).toHaveText('false');
});
test('conflicting save retains edits and requires reload without overwrite', async ({ page }) => {
  const writes = await mock(page, { conflict: true });
  await page.goto('/test/native-game-config.fixture.html');
  await page.getByLabel('Server name', { exact: true }).fill('Draft name');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('file changed');
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Draft name');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reload changed file' }).click();
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Puszka Pandory [FFA] @eserv.pl');
  expect(writes).toHaveLength(1);
});
test('uses actual CFG path and retains drafts between internal sections', async ({ page }) => {
  const writes = await mock(page, { path: '/serverfiles/cstrike/ffa.cfg' });
  await page.goto('/test/native-game-config.fixture.html');
  await page.getByLabel('Map time limit', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Configuration files 2' }).click();
  await expect(page.getByRole('heading', { name: 'Map rotation' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Map time limit', { exact: true })).toHaveValue('40');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText(/Configuration saved/)).toBeVisible();
  expect(writes[0].path).toBe('/serverfiles/cstrike/ffa.cfg');
});
test('readonly users cannot change configuration and missing versions prevent saves', async ({ page }) => {
  await mock(page, { version: false });
  await page.goto('/test/native-game-config.fixture.html');
  await expect(page.getByText(/did not provide a file version/)).toBeVisible();
  await expect(page.getByLabel('Server name', { exact: true })).toBeDisabled();
  await page.goto('/test/native-game-config.fixture.html?readonly');
  await expect(page.getByText(/Read-only access/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0);
});
test('invalid numbers cannot be saved and compound CFG commands stay in file editor', async ({ page }) => {
  await mock(page);
  await page.goto('/test/native-game-config.fixture.html');
  await page.getByLabel('Map time limit', { exact: true }).fill('-5');
  await expect(page.getByRole('alert')).toContainText('Minimum');
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toBeDisabled();
  await page.unrouteAll();
  await mock(page, { content: 'hostname "old"; exec other.cfg\n' });
  await page.reload();
  await expect(page.getByText(/compound commands/)).toBeVisible();
  await expect(page.getByLabel('Server name', { exact: true })).toBeDisabled();
});
test('missing config has a retry; file-read access is required', async ({ page }) => {
  await mock(page, { failure: true });
  await page.goto('/test/native-game-config.fixture.html');
  await expect(page.getByRole('alert')).toContainText('Configuration file not found');
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  await page.goto('/test/native-game-config.fixture.html?noaccess');
  await expect(page.getByText('File read permission is required to view Game Config.')).toBeVisible();
});
test('configuration has no horizontal overflow on desktop or mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await mock(page);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/test/native-game-config.fixture.html');
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Puszka Pandory [FFA] @eserv.pl');
  await page.screenshot({ path: '/tmp/game-config-premium-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/game-config-premium-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('template editor edits the preset path and custom fields', async ({ page }) => {
  await page.goto('/test/native-game-config.fixture.html?template');
  await page.getByLabel('Game Config path').fill('/serverfiles/cstrike/custom.cfg');
  await expect(page.getByLabel('Template form path')).toHaveText('/serverfiles/cstrike/custom.cfg');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByRole('button', { name: 'Add setting', exact: true }).last().click();
  await expect(page.locator('summary').last()).toContainText('New setting');
});

test('manual config edits refresh the game name without changing the panel alias or overwriting a draft', async ({ page }) => {
  await mock(page);
  await page.goto('/test/native-game-config.fixture.html');
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Puszka Pandory [FFA] @eserv.pl');
  await page.unrouteAll();
  const writes = await mock(page, { content: original.replace('[FFA]', '[Deathrun]'), etag: '"external-version"' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Puszka Pandory [Deathrun] @eserv.pl');
  await page.getByLabel('Server name', { exact: true }).fill('Unsaved name');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Server name', { exact: true })).toHaveValue('Unsaved name');
  expect(writes).toHaveLength(0);
});
