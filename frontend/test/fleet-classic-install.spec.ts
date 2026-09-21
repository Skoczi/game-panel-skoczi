import { test, expect } from '@playwright/test';
const node = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(id => { sessionStorage.setItem('gamepanel_node_scope_1', id); localStorage.setItem('theme', 'dark'); }, node);
  await page.route('**/api/**', r => !new URL(r.request().url()).pathname.startsWith('/api/') ? r.continue() : r.fulfill({ json: {} }));
  await page.route('**/api/fleet', r => r.fulfill({ json: { servers: [] } }));
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [] } }));
  await page.route('**/api/nodes', r => r.fulfill({ json: { local: { name: 'FR1' }, nodes: [{ id: node, name: 'WAW1', status: 'online', enabled: 1 }] } }));
  await page.route('**/api/catalog/linuxgsm/games', r => r.fulfill({ json: { games: [{ shortname: 'cs', gamename: 'Counter-Strike 1.6', gameservername: 'csserver' }] } }));
  await page.route('**/api/catalog/games', r => r.fulfill({ json: { games: [] } }));
  await page.route('**/linuxgsm/metadata', r => r.fulfill({ json: { games: [] } }));
});
test('LinuxGSM searches games, opens the old configuration form and uses target-node IPs', async ({ page }) => {
  await page.route('**/linuxgsm/metadata/cs', r => r.fulfill({ json: { shortname: 'cs', ports: { tcp: [], udp: [{ host: 27015, container: 27015 }] } } }));
  const ips: string[] = [];
  await page.route('**/api/system/bind-addresses', r => { ips.push(new URL(r.request().url()).pathname); return r.fulfill({ json: { addresses: ['192.0.2.10'] } }); });
  await page.goto('/test/node-scope.fixture.html');
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await expect(page.getByText('Panel templates · native installation, configuration and console.')).toHaveCount(0);
  await page.getByRole('button', { name: 'LinuxGSM', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Execution node', exact: true })).toContainText('WAW1');
  await page.getByPlaceholder('Search games…').last().fill('Counter');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Install Counter-Strike 1.6 LinuxGSM/ })).toBeVisible();
  await page.getByRole('button', { name: /Advanced/ }).click();
  await page.getByRole('button', { name: /Ports Binding/ }).click();
  await expect.poll(() => ips.length).toBeGreaterThan(0);
  expect(ips.every(p => p === `/api/nodes/${node}/runtime/api/system/bind-addresses`)).toBe(true);
});
test('Custom image submits only to the selected node and reads its installation progress', async ({ page }) => {
  let path = '', body: any;
  await page.route('**/api/servers/install', r => { path = new URL(r.request().url()).pathname; body = r.request().postDataJSON(); return r.fulfill({ json: { server: { id: 9 } } }); });
  await page.routeWebSocket(`**/api/nodes/${node}/ws`, ws => ws.onMessage(raw => {
    const message = JSON.parse(String(raw));
    if (message.type === 'auth') ws.send(JSON.stringify({ type: 'auth:success' }));
    if (message.type === 'subscribe:install') {
      expect(message.serverId).toBe(9);
      ws.send(JSON.stringify({ type: 'install:progress', serverId: 9, progress: 100, status: 'completed' }));
    }
  }));
  await page.goto('/test/node-scope.fixture.html');
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await page.getByRole('button', { name: 'Custom image', exact: true }).click();
  await expect(page.getByText('Custom Docker image', { exact: true })).toBeVisible();
  await page.getByPlaceholder('ghcr.io/user/image:latest').fill('example/game:1');
  await page.getByPlaceholder('My Custom Server').fill('Test custom');
  await page.getByPlaceholder('root', { exact: true }).fill('1000');
  await page.getByPlaceholder('0', { exact: true }).nth(0).fill('1000');
  await page.getByPlaceholder('0', { exact: true }).nth(1).fill('1000');
  await page.getByRole('button', { name: 'Install Server', exact: true }).click();
  await expect.poll(() => path).toBe(`/api/nodes/${node}/runtime/api/servers/install`);
  expect(body.dockerImage).toBe('example/game:1');
  await expect(page.getByRole('dialog')).toContainText('Installation started');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Custom image', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_admin_runtime'))).toBeNull();
});
