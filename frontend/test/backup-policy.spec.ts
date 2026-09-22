import { test, expect, type Page } from '@playwright/test';
async function mock(page: Page, options: { conflict?: boolean; unavailable?: boolean; configured?: boolean } = {}) {
  const writes: unknown[] = [], imports: unknown[] = [];
  let policy = { revision: 0, automaticRetention: false, keepLocal: 7, externalCopy: false, keepExternal: 14 };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/policy')) {
      if (route.request().method() === 'PATCH') {
        writes.push(route.request().postDataJSON());
        if (options.conflict) return route.fulfill({ status: 409, json: { error: 'Backup settings changed. Reload before saving.' } });
        policy = { ...route.request().postDataJSON(), revision: 1 };
      }
      return route.fulfill({ json: { policy, destination: { configured: options.configured !== false, label: 'OVH Backup Storage' } } });
    }
    if (url.pathname.endsWith('/external/import')) { imports.push(route.request().postDataJSON()); return route.fulfill({ status: 202, json: { job: { id: 'import-job' } } }); }
    if (url.pathname.endsWith('/jobs/import-job')) return route.fulfill({ json: { job: { status: 'completed', result: { ok: true } } } });
    if (url.pathname.endsWith('/external')) {
      if (options.unavailable) return route.fulfill({ status: 503, json: { error: 'External storage is offline.' } });
      return route.fulfill({ json: { backups: [{ name: 'native-nightly.tar.gz', sizeBytes: 320000000, sha256: 'a'.repeat(64), createdAt: '2026-09-22T03:15:00Z', mode: 'live' }] } });
    }
    return route.fulfill({ json: {} });
  });
  return { writes, imports };
}
test('backup protection is opt-in, validates counts and saves reviewed choices', async ({ page }) => {
  const { writes } = await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/backup-policy.fixture.html');
  await expect(page.getByRole('switch', { name: 'Automatic retention' })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Automatic retention' }).click();
  await page.getByLabel('Local backups to keep').fill('0');
  await expect(page.getByRole('button', { name: 'Save protection settings' })).toBeDisabled();
  await page.getByLabel('Local backups to keep').fill('3');
  await page.getByRole('switch', { name: 'Copy to external storage' }).click();
  await page.getByLabel('External backups to keep').fill('10');
  await page.getByRole('button', { name: 'Save protection settings' }).click();
  await expect(page.getByRole('status')).toContainText('next successful backup');
  expect(writes).toEqual([{ revision: 0, automaticRetention: true, keepLocal: 3, externalCopy: true, keepExternal: 10 }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/backup-protection-mobile.png', fullPage: true });
});
test('stale policy is not silently overwritten and edits remain visible', async ({ page }) => {
  const { writes } = await mock(page, { conflict: true });
  await page.goto('/test/backup-policy.fixture.html');
  await page.getByRole('switch', { name: 'Automatic retention' }).click();
  await page.getByLabel('Local backups to keep').fill('5');
  await page.getByRole('button', { name: 'Save protection settings' }).click();
  await expect(page.getByRole('alert')).toContainText('Reload before saving');
  await expect(page.getByLabel('Local backups to keep')).toHaveValue('5');
  expect(writes).toHaveLength(1);
});
test('external copy import retrieves an archive without restoring or restarting the game', async ({ page }) => {
  const { imports } = await mock(page);
  await page.goto('/test/backup-policy.fixture.html');
  await page.getByRole('button', { name: 'Show / refresh copies' }).click();
  await page.getByRole('button', { name: 'Import to local backups' }).click();
  await expect(page.getByRole('status')).toContainText('Copy imported and checked');
  expect(imports).toEqual([{ name: 'native-nightly.tar.gz' }]);
  await expect(page.getByLabel('Imports refreshed')).toHaveText('1');
});
test('unavailable destination is shown as an error, never as an empty successful inventory', async ({ page }) => {
  await mock(page, { unavailable: true });
  await page.goto('/test/backup-policy.fixture.html');
  await page.getByRole('button', { name: 'Show / refresh copies' }).click();
  await expect(page.getByRole('alert')).toContainText('offline');
  await expect(page.getByText('No completed external copies found.')).toHaveCount(0);
});
test('read-only users cannot enable retention or import copies', async ({ page }) => {
  const { writes, imports } = await mock(page);
  await page.goto('/test/backup-policy.fixture.html?readonly');
  await expect(page.getByRole('switch', { name: 'Automatic retention' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Save protection settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show / refresh copies' }).click();
  await expect(page.getByRole('button', { name: 'Import to local backups' })).toBeDisabled();
  expect(writes).toHaveLength(0); expect(imports).toHaveLength(0);
});

test('dark desktop layout keeps storage and retention controls readable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await mock(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/test/backup-policy.fixture.html');
  await page.getByRole('switch', { name: 'Automatic retention' }).click();
  await page.getByRole('switch', { name: 'Copy to external storage' }).click();
  await page.getByRole('button', { name: 'Show / refresh copies' }).click();
  await expect(page.getByRole('button', { name: 'Import to local backups' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/backup-protection-desktop-dark.png', fullPage: true });
});
