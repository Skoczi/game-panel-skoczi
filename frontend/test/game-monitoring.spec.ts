import { test, expect } from '@playwright/test';
const settings = () => ({
    config: { enabled: true, protocol: 'a2s', queryPort: 28015, intervalSeconds: 30, startupGraceSeconds: 90, failureThreshold: 3 },
    summary: { enabled: true, state: 'online', checkedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), failures: 0, incidentStartedAt: null, error: null, info: { name: 'BoB', map: 'de_dust2', players: 0, maxPlayers: 16, bots: 0 }, latencyMs: 4, runtimeKey: 'one', staleAfterSeconds: 100 },
    ports: [{ host: 30001, container: 28015, label: 'Game / Query' }, { host: 30002, container: 28016, label: 'Secondary query' }], templateProfile: false,
});
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('theme', 'dark'); sessionStorage.setItem('gamepanel_admin_runtime', '1'); });
});
test('mobile monitoring shows real zero players, custom query selector and saves server-specific settings', async ({ page }) => {
    let value = settings(); let saved: any;
    await page.route('**/api/servers/7/monitoring', route => {
        if (route.request().method() === 'PATCH') { saved = route.request().postDataJSON(); value = { ...value, config: saved }; }
        return route.fulfill({ json: value });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/test/game-monitoring.fixture.html');
    await expect(page.getByText('Game responding', { exact: true })).toBeVisible();
    await expect(page.getByText('0 / 16', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Game query port' }).click();
    await page.getByRole('option', { name: 'Secondary query · 30002 → 28016' }).click();
    await page.getByLabel('Check interval (seconds)').fill('45');
    await page.getByRole('button', { name: 'Save monitoring settings' }).click();
    await expect(page.getByRole('status')).toHaveText('Monitoring settings saved.');
    expect(saved.queryPort).toBe(28016); expect(saved.intervalSeconds).toBe(45);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/gamepanel-monitor-mobile.png', fullPage: true });
});
test('stale observations clear map and player counts instead of showing cached values', async ({ page }) => {
    await page.clock.install();
    await page.goto('/test/game-monitoring.fixture.html?status');
    await expect(page.getByText('de_dust2')).toBeVisible();
    await page.clock.fastForward(20000);
    await expect(page.getByText('No recent game data')).toBeVisible();
    await expect(page.getByText('de_dust2')).toHaveCount(0);
    await expect(page.getByText('0 / 16')).toHaveCount(0);
});
test('failed save stays visible and never reports success', async ({ page }) => {
    await page.route('**/api/servers/7/monitoring', route => route.fulfill(route.request().method() === 'PATCH' ? { status: 400, json: { error: 'Select an allocated UDP query port' } } : { json: settings() }));
    await page.goto('/test/game-monitoring.fixture.html');
    await page.getByRole('button', { name: 'Save monitoring settings' }).click();
    await expect(page.getByRole('alert')).toHaveText('Select an allocated UDP query port');
    await expect(page.getByText('Monitoring settings saved.')).toHaveCount(0);
});
test('template monitoring can be enabled with a declared UDP port', async ({ page }) => {
    await page.goto('/test/game-monitoring.fixture.html?template');
    await page.getByRole('switch', { name: 'Enable monitoring by default' }).click();
    await expect(page.getByRole('combobox', { name: 'Template query port' })).toContainText('Game / Query · UDP 27015');
    await page.getByRole('switch', { name: 'Enable monitoring by default' }).click();
    await expect(page.getByRole('combobox', { name: 'Template query port' })).toHaveCount(0);
});
