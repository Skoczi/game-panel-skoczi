import { test, expect } from '@playwright/test';
const template = { schemaVersion: 2, name: 'ReHLDS', variables: [{ key: 'MAP', label: 'Map', default: 'de_dust' }, { key: 'MAX_PLAYERS', label: 'Max players', default: '32' }, { key: 'SERVER_NAME', label: 'Hostname', default: 'Game server' }], ports: [{ env: 'SERVER_PORT' }], lifecycle: { startup: ['/bin/bash', '-c', 'set -e\nexec ./hlds_linux "$@"', 'hlds', '-port', '{{SERVER_PORT}}', '+map', '{{MAP}}'], update: [] } };
const server = { dockerImage: 'gamepanel/rehlds:latest', providerMetadata: { template: { document: template, version: 1 } }, ports: { tcp: [], udp: [{ host: 27050, container: 27015, hostIp: '51.83.150.145', label: 'Game / Query / RCON' }] }, env: { MAP: 'de_dust', MAX_PLAYERS: '32', SERVER_NAME: 'My server', SERVER_PORT: '27015' }, mounts: [{ key: 'data', containerPath: '/data' }], resourceLimits: { cpu: 1, memoryMb: 1024 } };
test('settings preview, parameter editing and port checks preserve IP and block stale availability', async ({ page }) => {
 page.on('pageerror', e => console.error(e.message));
 await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
 let saved: any; let free = [27051, 27052];
 await page.route('**/api/**', async route => {
  const r = route.request(); const path = new URL(r.url()).pathname;
  if (!path.startsWith('/api/')) return route.continue();
  if (path.endsWith('/available-ports')) return route.fulfill({ json: { ports: free } });
  if (r.method() === 'PATCH') { saved = r.postDataJSON(); return route.fulfill({ json: { success: true } }); }
  return route.fulfill({ json: server });
 });
 await page.goto('/test/container-settings.fixture.html');
 await expect(page.locator('.gp-settings-startup pre')).toHaveText('./hlds_linux -port 27015 +map de_dust');
 await expect(page.getByText('/bin/bash', { exact: false })).toHaveCount(0);
 await page.getByLabel('Map', { exact: true }).fill('de_dust2');
 await expect(page.locator('.gp-settings-startup pre')).toContainText('+map de_dust2');
 await page.getByRole('button', { name: 'Edit startup parameters' }).click();
 await expect(page.getByText('Dostępne parametry:', { exact: true })).toBeVisible();
 await expect(page.locator('.gp-startup-variables')).toContainText('{{SERVER_PORT}}');
 await page.getByLabel('Startup parameters').fill('./hlds_linux -port {{SERVER_PORT}} +map {{MAP}} +maxplayers {{MAX_PLAYERS}}');
 await expect(page.locator('.gp-settings-startup pre')).toContainText('+maxplayers 32');
 const port = page.getByLabel('UDP public port 1');
 await port.fill('27060');
 await expect(page.getByText('Port unavailable. Choose an available port.')).toBeVisible();
 await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
 await port.fill('27051');
 await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
 free = []; // Another server reserves it after the background check.
 await page.getByRole('button', { name: 'Save changes' }).click();
 await expect(page.getByText('Port unavailable. Choose an available port.').first()).toBeVisible();
 expect(saved).toBeUndefined();
 free = [27051, 27052];
 await page.getByRole('button', { name: 'Refresh available ports' }).click();
 await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
 await page.getByRole('button', { name: 'Save changes' }).click();
 await expect(page.getByText('Settings saved.')).toBeVisible();
 expect(saved.ports.udp[0]).toMatchObject({ hostIp: '51.83.150.145', host: 27051, container: 27015 });
 expect(saved.startupCommand).toContain('{{MAP}}');
 expect(saved.env.MAP).toBe('de_dust2');
 await page.getByRole('button', { name: 'Close editor' }).click();
 await page.screenshot({ path: 'test-results/settings-desktop.png', fullPage: true });
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
});

test('running servers can save for later without submitting a restart', async ({ page }) => {
 let payload: any;
 await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (!path.startsWith('/api/')) return route.continue();
  if (path.endsWith('/available-ports')) return route.fulfill({ json: { ports: [27050] } });
  if (route.request().method() === 'PATCH') { payload=route.request().postDataJSON(); return route.fulfill({ json: { success: true } }); }
  return route.fulfill({ json: server });
 });
 await page.goto('/test/container-settings.fixture.html?running');
 await page.getByLabel('Custom params', { exact: true }).fill('+sv_lan 0 -tickrate 128');
 await expect(page.locator('.gp-settings-startup pre')).toContainText('+sv_lan 0 -tickrate 128');
 await page.getByLabel('Map', { exact: true }).fill('de_dust2');
 await page.getByRole('button', { name: 'Save changes', exact: true }).click();
 const dialog = page.getByRole('dialog', { name: 'Save changes' });
 await expect(dialog.getByRole('button', { name: 'Save without restart' })).toBeVisible();
 await dialog.getByRole('button', { name: 'Save without restart' }).click();
 await expect(page.getByText('Saved. Changes apply on the next start or restart from the panel.')).toBeVisible();
 expect(payload.applyMode).toBe('defer');
 expect(payload.customParams).toEqual(['+sv_lan','0','-tickrate','128']);
 expect(payload.env.MAP).toBe('de_dust2');
});
