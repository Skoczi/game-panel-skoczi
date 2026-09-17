import { test, expect, type Page } from '@playwright/test';

const initial = () => ({ revision: 1, appearance: { showFollowUs: true, showTrustpilot: true }, network: { restrictPorts: true, allocations: [{ ip: '192.0.2.10', alias: 'Game node', tcp: '27015-27030', udp: '27015-27030' }] }, assignments: [{ serverId: 1, serverName: 'Test game', ip: '192.0.2.10', port: 27015, protocol: 'udp' }] });
async function mock(page: Page, conflict = false) {
  let state = initial();
  await page.route('**/api/system/update/check', (route) => route.fulfill({ json: { updateAvailable: false } }));
  await page.route('**/api/system/appearance', (route) => route.fulfill({ json: state.appearance }));
  await page.route('**/api/system/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      if (conflict) { await route.fulfill({ status: 409, json: { error: 'Settings changed. Reload before saving.' } }); return; }
      state = { ...route.request().postDataJSON(), revision: state.revision + 1, assignments: state.assignments };
      const { assignments: _assignments, ...saved } = state;
      await route.fulfill({ json: saved }); return;
    }
    await route.fulfill({ json: state });
  });
  return () => state;
}

test('root edits allocations, saves appearance and sees changes in the sidebar', async ({ page }) => {
  const state = await mock(page);
  await page.goto('/test/settings.fixture.html');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Follow Us', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Trustpilot', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove 192.0.2.10' })).toBeDisabled();
  await page.getByLabel('IP address', { exact: true }).fill('192.0.2.11');
  await page.getByLabel('Alias (optional)').fill('Second node');
  await page.getByLabel('TCP ports', { exact: true }).fill('28015-28020');
  await page.getByLabel('UDP ports', { exact: true }).fill('28015');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByText('Second node', { exact: true })).toBeVisible();
  await page.getByLabel('Show Follow Us').uncheck(); await page.getByLabel('Show Trustpilot').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved. Changes are active.');
  await expect(page.getByText('Follow Us', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Trustpilot', exact: true })).toHaveCount(0);
  expect(state().network.allocations[1].tcp).toBe('28015-28020');
  await expect(page.getByText(/Game Panel by Skoczi · v/)).toBeVisible();
  await page.reload(); await expect(page.getByText('Second node', { exact: true })).toBeVisible();
});

test('conflicting save preserves edits and offers reload', async ({ page }) => {
  await mock(page, true); await page.goto('/test/settings.fixture.html');
  await page.getByLabel('Show Follow Us').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toHaveText('Settings changed. Reload before saving.');
  await expect(page.getByLabel('Show Follow Us')).not.toBeChecked();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
});

test('non-root menu has no global Settings entry', async ({ page }) => {
  await mock(page); await page.goto('/test/settings.fixture.html?nonroot');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
});

test('settings stays within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page); await page.goto('/test/settings.fixture.html');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel('IP address', { exact: true })).toBeVisible();
});
