import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error(error));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('requestfailed', request => console.error(request.url(), request.failure()));
});

test('native settings expose configuration, backup, tasks and data roots without External badge', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/files/roots')) return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (url.pathname.endsWith('/files')) {
      const p = url.searchParams.get('path');
      const entries = p === '/' ? [{ name: 'serverfiles', type: 'dir' }] : p === '/serverfiles' ? [{ name: 'cstrike', type: 'dir' }] : [{ name: 'server.cfg', type: 'file' }];
      return route.fulfill({ json: { path: p, entries } });
    }
    if (url.pathname.endsWith('/backups')) return route.fulfill({ json: { path: '/', entries: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/test/native-settings.fixture.html');
  await expect(page.getByText('External', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Game Config', exact: true })).toBeVisible();
  await expect(page.getByText('/serverfiles/cstrike/server.cfg', { exact: true })).toBeVisible();
  await expect(page.getByText('Native game configuration', { exact: true })).toBeVisible();
  await expect(page.getByText(/Installation and startup are managed/)).toHaveCount(0);
  await expect(page.getByText(/Game files remain in the location/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Backups', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create backup now' })).toBeVisible();
  await expect(page.getByText(/Live backups may contain/)).toBeVisible();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/native-settings-backups.png' });
});

test('arbitrary external images keep their unsupported features hidden', async ({ page }) => {
  await page.route('**/api/**', r => new URL(r.request().url()).pathname.startsWith('/api/') ? r.fulfill({ json: { entries: [], roots: [{ key: 'data', containerPath: '/data' }] } }) : r.continue());
  await page.goto('/test/native-settings.fixture.html?external');
  await expect(page.getByText('External', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Game Config', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Backups', exact: true })).toHaveCount(0);
});

test('closing action history preserves the native Activity subscription', async ({ page }) => {
  await page.goto('/test/native-settings.fixture.html?external');
  const result = await page.evaluate(async () => {
    const { RealtimeGateway } = await import('/utils/api/realtimeGateway.ts');
    const gateway: any = new RealtimeGateway(() => null);
    const messages: any[] = [];
    gateway.ws = { readyState: WebSocket.OPEN, send: (message: string) => messages.push(JSON.parse(message)) };
    gateway.wsAuthed = true;
    gateway.subscribeActions(7, 200, 'native-activity');
    gateway.subscribeActions(7);
    gateway.unsubscribeActions(7);
    const retained = gateway.pendingActionsSubscriptions.has(7) && !messages.some(m => m.type === 'unsubscribe');
    gateway.unsubscribeActions(7, 'native-activity');
    return { retained, removed: !gateway.pendingActionsSubscriptions.has(7), count: messages.filter(m => m.type === 'unsubscribe').length };
  });
  expect(result).toEqual({ retained: true, removed: true, count: 1 });
});

test('declared config opens the actual nested file and native settings fit dark mobile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/files/roots')) return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (url.pathname.endsWith('/file')) return route.fulfill({ json: { content: 'hostname native-test' } });
    return route.fulfill({ json: { entries: [{ name: 'server.cfg', type: 'file' }] } });
  });
  await page.goto('/test/native-settings.fixture.html?declared');
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/native-settings-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const requested = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/file'));
  await page.getByRole('button', { name: 'Open in File Manager' }).click();
  const url = new URL((await requested).url());
  expect(url.searchParams.get('root')).toBe('data');
  expect(url.searchParams.get('path')).toBe('/serverfiles/cstrike/server.cfg');
});
