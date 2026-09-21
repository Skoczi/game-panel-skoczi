import { test, expect } from '@playwright/test';
const serverId = '11111111-1111-4111-8111-111111111111';
for (const theme of ['light', 'dark']) test(`API token creation, secret disposal and revoke confirmation in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let issued = false, revoked = false, mutations = 0;
  const token = { id: 'issued', name: 'Monitoring', scopes: ['servers.read'], serverIds: [serverId], expiresAt: Date.now() + 86400000, revokedAt: null, lastUsedAt: null };
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path === '/api/fleet') return route.fulfill({ json: { servers: [{ id: serverId, name: 'My server' }] } });
    if (req.method() === 'POST') {
      mutations++; issued = true;
      expect(req.postDataJSON()).toMatchObject({ name: 'Monitoring', scopes: ['servers.read', ...(theme === 'dark' ? ['resources.read'] : [])], serverIds: [serverId] });
      return route.fulfill({ status: 201, json: { token, secret: 'gpp_fixture_secret' } });
    }
    if (req.method() === 'DELETE') { mutations++; revoked = true; return route.fulfill({ status: 204 }); }
    return route.fulfill({ json: { tokens: issued ? [{ ...token, revokedAt: revoked ? Date.now() : null }] : [] } });
  });
  await page.goto('/test/api-tokens.fixture.html');
  await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
  await expect(page.getByRole('dialog', { name: 'API tokens', exact: true })).toBeVisible();
  await expect(page.getByLabel('Token name')).toHaveCSS('font-family', /Source Sans/);
  await expect(page.locator('.gp-app-input').first()).toHaveCSS('border-top-width', '1px');
  await expect(page.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await page.getByLabel('Token name').fill('Monitoring');
  if (theme === 'dark') await page.getByRole('switch', { name: 'Read resource measurements' }).check();
  await page.getByRole('checkbox', { name: /My server/ }).check();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: `test-results/api-tokens-${theme}-mobile.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByLabel('New API token', { exact: true })).toHaveValue('gpp_fixture_secret');
  expect(mutations).toBe(1);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('gpp_fixture_secret');
  await page.getByRole('button', { name: 'I have saved the token' }).click();
  await expect(page.getByLabel('New API token', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke Monitoring' }).click();
  const confirm = page.getByRole('dialog', { name: 'Revoke API token?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(mutations).toBe(1);
  await page.getByRole('button', { name: 'Revoke Monitoring' }).click();
  await confirm.getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  expect(mutations).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('uncertain token creation is not retried or shown as success', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/**', async route => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
    if (route.request().method() === 'POST') { posts++; return route.abort('failed'); }
    return route.fulfill({ json: { tokens: [], servers: [{ id: serverId, name: 'My server' }] } });
  });
  await page.goto('/test/api-tokens.fixture.html');
  await page.getByLabel('Token name').fill('Monitoring');
  await page.getByRole('checkbox', { name: /My server/ }).check();
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByRole('alert')).toContainText('not confirmed');
  await expect(page.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await expect(page.getByLabel('New API token', { exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
});

test('backup token scopes are explicit and a permission rejection keeps the form editable', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/**', async route => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
    if (route.request().method() === 'POST') {
      posts++;
      expect(route.request().postDataJSON().scopes).toEqual(['servers.read', 'backups.read', 'backups.create', 'operations.read']);
      return route.fulfill({ status: 403, json: { error: 'Requested token access exceeds your server permissions' } });
    }
    return route.fulfill({ json: { tokens: [], servers: [{ id: serverId, name: 'My server' }] } });
  });
  await page.goto('/test/api-tokens.fixture.html');
  await page.getByLabel('Token name').fill('Nightly backup');
  await page.getByRole('checkbox', { name: /My server/ }).check();
  await page.getByRole('switch', { name: 'Read backup lists' }).check();
  await page.getByRole('switch', { name: 'Create Native backups and read their status' }).check();
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByRole('alert')).toContainText('exceeds your server permissions');
  await expect(page.getByRole('button', { name: 'Create token' })).toBeEnabled();
  expect(posts).toBe(1);
});
