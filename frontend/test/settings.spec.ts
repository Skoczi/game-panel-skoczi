import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_APPEARANCE } from '../types/globalSettings';
import { formatDisplayVersion } from '../utils/appInfo';

test('display revisions remain separate from technical package versions', () => {
  expect(formatDisplayVersion('1.5.0-skoczi.6')).toBe('v1.5.0 · Revision 6');
  expect(formatDisplayVersion('1.5.0-skoczi.12')).toBe('v1.5.0 · Revision 12');
  expect(formatDisplayVersion('1.6.0-skoczi.7')).toBe('v1.6.0 · Revision 7');
  expect(formatDisplayVersion('1.5.0-skoczi.4.1')).toBe('v1.5.0 · Revision 4.1');
  expect(formatDisplayVersion('0.0.0-dev')).toBe('0.0.0-dev');
});

const initial = () => ({
  revision: 1,
  appearance: { ...DEFAULT_APPEARANCE },
  network: {
    restrictPorts: true,
    allocations: [{ ip: '192.0.2.10', alias: 'Game node', tcp: '27015-27030', udp: '27015-27030' }],
  },
  assignments: [
    { serverId: 1, serverName: 'Test game', ip: '192.0.2.10', port: 27015, protocol: 'udp' },
  ],
});
async function mock(page: Page, conflict = false) {
  await page.route('**/api/nodes', (route) => route.fulfill({ json: { nodes: [] } }));
  let state = initial();
  await page.route('**/api/system/update/check', (route) =>
    route.fulfill({ json: { updateAvailable: false } })
  );
  await page.route('**/api/system/appearance', (route) =>
    route.fulfill({ json: state.appearance })
  );
  await page.route('**/api/branding', (route) => route.fulfill({ json: state.appearance }));
  await page.route('**/news?*', (route) => route.fulfill({ json: { news: [] } }));
  await page.route('**/api/system/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      if (conflict) {
        await route.fulfill({
          status: 409,
          json: { error: 'Settings changed. Reload before saving.' },
        });
        return;
      }
      state = {
        ...route.request().postDataJSON(),
        revision: state.revision + 1,
        assignments: state.assignments,
      };
      const { assignments: _assignments, ...saved } = state;
      await route.fulfill({ json: saved });
      return;
    }
    await route.fulfill({ json: state });
  });
  await page.route('**/api/nodes/*/allocations', async (route) => {
    if (route.request().method() === 'PUT') {
      const value = route.request().postDataJSON();
      expect(Object.keys(value).sort()).toEqual(['network', 'revision']);
      state = { ...state, network: value.network, revision: state.revision + 1 };
    }
    await route.fulfill({
      json: {
        revision: state.revision,
        network: state.network,
        assignments: state.assignments,
        pending: false,
      },
    });
  });
  return () => state;
}

test('branding persists across login, sidebar and title; disabled news does not fetch', async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto('/test/settings.fixture.html');
  await page.getByLabel('Site name', { exact: true }).fill('Example Games');
  await page.getByLabel('Subtitle (optional)', { exact: true }).fill('Community servers');
  await page.getByLabel('Login description (optional)').fill('Welcome back');
  await page.getByLabel('Login footer text').fill('Example Games — support@example.com');
  await page.getByLabel('Upload logo').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=',
      'base64'
    ),
  });
  await page.getByLabel('Show announcements').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page).toHaveTitle('Example Games');
  expect(state().appearance.logo).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('aside').getByText('Example Games', { exact: true })).toBeVisible();
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/news')) requests++;
  });
  await page.reload();
  await expect(page.getByLabel('Show announcements')).not.toBeChecked();
  await expect(page.getByRole('region', { name: 'News carousel' })).toHaveCount(0);
  expect(requests).toBe(0);
  await page.goto('/test/settings.fixture.html?login');
  await expect(page.getByRole('heading', { name: 'Example Games' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example Games' })).toHaveCSS(
    'color',
    'rgb(255, 255, 255)'
  );
  await expect(page.getByRole('img', { name: 'Example Games logo' })).toBeVisible();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByText('Example Games — support@example.com')).toBeVisible();
  await expect(page.getByText(/© 2026 OVHcloud/)).toHaveCount(0);
});

test('footer hides, text is escaped and broken logo keeps login usable', async ({ page }) => {
  await mock(page);
  await page.route('**/api/branding', (route) =>
    route.fulfill({
      json: {
        ...DEFAULT_APPEARANCE,
        siteName: '<script>bad()</script>',
        showLoginFooter: false,
        logo: 'https://example.com/missing.png',
      },
    })
  );
  await page.route('https://example.com/missing.png', (route) => route.fulfill({ status: 404 }));
  await page.goto('/test/settings.fixture.html?login');
  await expect(page.getByRole('heading', { name: '<script>bad()</script>' })).toBeVisible();
  await expect(page.getByText(DEFAULT_APPEARANCE.loginFooter, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('img', { name: '<script>bad()</script> logo', exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test('login theme saves with live preview and stays separate from the panel theme', async ({
  page,
}) => {
  const state = await mock(page);
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('/test/settings.fixture.html');
  await page.getByRole('combobox', { name: 'Login page theme' }).click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.getByTestId('login-preview')).toHaveAttribute('data-login-theme', 'dark');
  await expect(page.locator('.gp-login-preview-card')).toHaveCSS(
    'background-color',
    'rgb(17, 28, 46)'
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(state().appearance.loginTheme).toBe('dark');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Login page theme' })).toContainText('Dark');
  await page.goto('/test/settings.fixture.html?login');
  await expect(page.locator('.gp-login-theme')).toHaveCSS('color-scheme', 'dark');
  await expect(page.getByLabel('Username', { exact: true })).toHaveCSS(
    'background-color',
    'rgb(11, 20, 36)'
  );
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 401, json: { error: 'Invalid credentials' } })
  );
  await page.getByLabel('Username', { exact: true }).fill('example');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCSS('background-color', 'rgb(50, 25, 34)');
  await page.getByLabel('Username', { exact: true }).fill('');
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/login-dark-mobile.png', fullPage: true });
});

test('system login theme follows OS changes, while light overrides a dark panel preference', async ({
  page,
}) => {
  await mock(page);
  let loginTheme = 'system';
  await page.route('**/api/branding', (route) =>
    route.fulfill({ json: { ...DEFAULT_APPEARANCE, loginTheme } })
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/test/settings.fixture.html?login');
  await expect(page.locator('.gp-login-theme')).toHaveCSS('color-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.gp-login-theme')).toHaveCSS('color-scheme', 'light');
  loginTheme = 'light';
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.classList.add('dark');
  });
  await page.reload();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(page.locator('.gp-login-theme')).toHaveCSS('color-scheme', 'light');
  await expect(page.getByLabel('Username', { exact: true })).toHaveCSS(
    'background-color',
    'rgb(248, 250, 252)'
  );
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
});

test('global settings only edits appearance and preserves Local allocations', async ({ page }) => {
  const state = await mock(page);
  await page.goto('/test/settings.fixture.html');
  await expect(page.locator('aside nav button')).toHaveText([
    'Game Servers', 'User Administration', 'Nodes', 'Panel Settings', 'Host Status', 'Resources',
  ]);
  await expect(page.getByRole('button', { name: 'Panel Settings', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Follow Us', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Trustpilot', exact: true })).toBeVisible();
  await expect(page.getByLabel('IP address', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show Follow Us').uncheck();
  await page.getByLabel('Show Trustpilot').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved. Changes are active.');
  await expect(page.getByText('Follow Us', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Trustpilot', exact: true })).toHaveCount(0);
  expect(state().network).toEqual(initial().network);
  const footerName = page
    .locator('aside')
    .getByText('Game Panel · Skoczi Edition', { exact: true });
  const revision = page.getByTestId('panel-revision');
  await expect(footerName).toBeVisible();
  await expect(revision).toHaveText('v1.5.0 · Revision 9');
  const upstream = page.getByRole('link', { name: 'Based on OVHcloud Game Panel' });
  await expect(upstream).toHaveAttribute('href', 'https://github.com/ovh/game-panel');
  await expect(upstream).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(revision.locator('..')).toHaveAttribute('title', /1\.5\.0-skoczi\.9/);
  await expect(page.getByRole('link', { name: 'Bug or feature?' })).toHaveAttribute(
    'href',
    'https://github.com/Skoczi/game-panel-skoczi/issues'
  );
  const nameBox = await footerName.boundingBox();
  const revisionBox = await revision.boundingBox();
  expect(revisionBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
  const creditBox = await upstream.boundingBox();
  expect(creditBox!.y).toBeGreaterThanOrEqual(revisionBox!.y + revisionBox!.height);
  expect(await footerName.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Show Follow Us')).not.toBeChecked();
});

test('node allocation editor saves only the selected node, not panel appearance', async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto('/test/settings.fixture.html?node=local');
  await expect(page.getByLabel('Show Follow Us')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove 192.0.2.10' })).toBeDisabled();
  await page.getByLabel('IP address', { exact: true }).fill('192.0.2.11');
  await page.getByLabel('Alias (optional)').fill('Second address');
  await page.getByLabel('TCP ports', { exact: true }).fill('28015-28020');
  await page.getByLabel('UDP ports', { exact: true }).fill('28015');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved. Changes are active.');
  expect(state().network.allocations[1].tcp).toBe('28015-28020');
  expect(state().appearance).toEqual(initial().appearance);
  await page.reload();
  await expect(page.getByText('Second address', { exact: true })).toBeVisible();
});

test('unconfirmed node save has a dedicated retry and does not send a fresh allocation update', async ({
  page,
}) => {
  await mock(page);
  let pending = true,
    retries = 0;
  const value = () => ({ revision: 2, network: initial().network, assignments: [], pending });
  await page.route('**/api/nodes/local/allocations', (r) => {
    expect(r.request().method()).toBe('GET');
    return r.fulfill({ json: value() });
  });
  await page.route('**/api/nodes/local/allocations/retry', (r) => {
    expect(r.request().method()).toBe('POST');
    retries++;
    pending = false;
    return r.fulfill({ json: value() });
  });
  await page.goto('/test/settings.fixture.html?node=local');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry pending save' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Pending save resolved. Current node settings loaded.'
  );
  expect(retries).toBe(1);
  await expect(page.getByRole('button', { name: 'Retry pending save' })).toHaveCount(0);
});

test('conflicting save preserves edits and offers reload', async ({ page }) => {
  await mock(page, true);
  await page.goto('/test/settings.fixture.html');
  await page.getByLabel('Show Follow Us').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toHaveText('Settings changed. Reload before saving.');
  await expect(page.getByLabel('Show Follow Us')).not.toBeChecked();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
});

test('non-root menu has no global Settings entry', async ({ page }) => {
  await mock(page);
  await page.goto('/test/settings.fixture.html?nonroot');
  await expect(page.getByRole('button', { name: 'Panel Settings', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('panel-revision')).toHaveText('v1.5.0 · Revision 9');
  await expect(page.getByRole('link', { name: 'Based on OVHcloud Game Panel' })).toBeVisible();
});

test('settings stays within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/test/settings.fixture.html');
  await expect(page.getByRole('heading', { name: 'Panel Settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await expect(page.getByLabel('IP address', { exact: true })).toHaveCount(0);
});
