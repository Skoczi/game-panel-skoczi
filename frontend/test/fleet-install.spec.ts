import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const node = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const document = JSON.parse(readFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8'));
const row = { id: 'test-rehlds', version: 3, status: 'published', document, hash: 'a'.repeat(64), actor: 'test', created_at: '' };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => !new URL(route.request().url()).pathname.startsWith('/api/') ? route.continue() : route.fulfill({ json: {} }));
  await page.route('**/api/fleet', r => r.fulfill({ json: { servers: [] } }));
  await page.route('**/api/nodes', r => r.fulfill({ json: { local: { id: 'local', name: 'FR1' }, nodes: [{ id: node, name: 'WAW1', location: 'Warsaw', status: 'online', enabled: 1 }] } }));
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [row, { ...row, version: 2 }, { ...row, version: 4, status: 'draft' }] } }));
  await page.route('**/allocations', r => r.fulfill({ json: { network: { allocations: [{ ip: '192.0.2.10', alias: 'Game IP', udp: '27015-27030', tcp: '' }] } } }));
  await page.route('**/api/servers/available-ports?*', r => r.fulfill({ json: { ports: [27015] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { templatesProtocol: 1, nativeRuntimeProtocol: 1, templateScriptsProtocol: 1, nativeSettingsProtocol: 1 } }));
  await page.route('**/api/servers/8', r => r.fulfill({ json: { server: { installProgress: { progress: 25, status: 'native_step_0' } } } }));
});
for (const scope of ['all', 'local', node]) test(`fleet Add Game Server opens templates and installs on the chosen node: ${scope}`, async ({ page }) => {
  await page.addInitScript(scope => sessionStorage.setItem('gamepanel_node_scope_1', scope), scope);
  const writes: Array<{ path: string; body: any }> = [];
  await page.route('**/prepare', r => { writes.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() }); return r.fulfill({ json: { ticket: 'selected-template' } }); });
  await page.route('**/api/servers/install', r => { writes.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() }); return r.fulfill({ json: { server: { id: 8 } } }); });
  await page.goto('/test/node-scope.fixture.html');
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Add game server', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: document.name, exact: true })).toHaveCount(1);
  await expect(page.getByText('v3 · Native')).toBeVisible();
  await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
  const choice = page.getByRole('combobox', { name: 'Execution node', exact: true });
  await expect(choice).toContainText(scope === node ? 'WAW1' : 'FR1');
  // With All nodes, the explicit destination can be selected in the form.
  if (scope === 'all') {
    await choice.click();
    await page.getByRole('option', { name: 'WAW1 · Warsaw', exact: true }).click();
  }
  const target = scope === 'local' ? 'local' : node;
  const ip = page.getByRole('combobox', { name: /Public IP/ });
  await ip.click();
  await page.getByRole('option', { name: /192\.0\.2\.10/ }).click();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual({ path: '/api/game-templates/test-rehlds/3/prepare', body: { nodeId: target } });
  expect(writes[1].path).toBe(`${target === 'local' ? '' : '/api/nodes/'+target+'/runtime'}/api/servers/install`);
  expect(writes[1].body.templateTicket).toBe('selected-template');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_admin_runtime'))).toBeNull();
});
test('catalog can be searched, cancelled and retried without navigating to Nodes', async ({ page }) => {
  await page.goto('/test/node-scope.fixture.html');
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search game templates' }).fill('no match');
  await expect(page.getByText('No templates match your search.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to servers', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Game servers workspace' })).toBeVisible();
  await page.route('**/api/game-templates', r => r.fulfill({ status: 503, json: { error: 'Catalog unavailable' } }));
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Catalog unavailable');
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [row] } }));
  await page.getByRole('button', { name: 'Retry templates' }).click();
  await expect(page.getByRole('heading', { name: document.name, exact: true })).toBeVisible();
});
