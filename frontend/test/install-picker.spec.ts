import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gameDisplayName } from '../utils/gameDisplayName';
import { fleetGame } from '../utils/fleetLayout';
const document = JSON.parse(readFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8'));
const row = { id: 'test-rehlds', version: 3, status: 'published', document, hash: 'a'.repeat(64), actor: 'test', created_at: '' };
const nodeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test('game labels omit the engine without changing the template identity', () => {
  expect(gameDisplayName('Counter-Strike 1.6 · ReHLDS')).toBe('Counter-Strike 1.6');
  expect(gameDisplayName('Counter-Strike 2')).toBe('Counter-Strike 2');
  expect(gameDisplayName('ReHLDS tools')).toBe('ReHLDS tools');
  expect(fleetGame({ provider: 'native', catalogId: document.name }, {})).toEqual({
    key: `native:${document.name}`, label: 'Counter-Strike 1.6',
  });
});
test.beforeEach(async ({ page }) => {
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [row, { ...row, version: 2 }, { ...row, version: 4, status: 'draft' }, { ...row, id: 'disabled', status: 'disabled', document: { ...document, name: 'Hidden disabled' } }] } }));
});
test('native templates are default; community is opt-in and reopening resets the picker', async ({ page }) => {
  await page.goto('/test/install-picker.fixture.html');
  await expect(page.getByRole('heading', { name: document.name, exact: true })).toHaveCount(1);
  await expect(page.getByText('v3 · Native')).toBeVisible();
  await expect(page.getByText('Hidden disabled')).toHaveCount(0);
  await expect(page.getByText('Minecraft', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Community Images', exact: true }).click();
  await expect(page.getByText('Community Images · third-party', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Custom image', exact: true }).click();
  await expect(page.getByText('Custom Docker image', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await expect(page.getByRole('heading', { name: document.name, exact: true })).toBeVisible();
});
test('native installer preserves the selected remote node and requests its allocations', async ({ page }) => {
  await page.addInitScript(id => { sessionStorage.setItem('gamepanel_active_node', id); sessionStorage.setItem('gamepanel_admin_runtime', '1'); }, nodeId);
  await page.route('**/api/nodes', r => r.fulfill({ json: { nodes: [{ id: nodeId, name: 'WAW1', status: 'online', location: 'Warsaw' }] } }));
  const allocations: string[] = [];
  await page.route('**/allocations', r => { allocations.push(r.request().url()); return r.fulfill({ json: { network: { allocations: [{ ip: '192.0.2.10', alias: 'WAW1', udp: '27015-27030', tcp: '' }] } } }); });
  await page.route('**/api/servers/available-ports?*', r => r.fulfill({ json: { ports: [27015, 27016] } }));
  await page.goto('/test/install-picker.fixture.html');
  await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
  await expect(page.getByText('Execution node: WAW1', { exact: true })).toBeVisible();
  await expect.poll(() => allocations.length).toBeGreaterThan(0);
  expect(allocations.every(url => url.includes(`/nodes/${nodeId}/`))).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Execution node' })).toHaveCount(0);
  const panelName = page.getByLabel('Panel server name', { exact: true });
  const gameName = page.getByLabel('In-game server name (visible to players) *', { exact: true });
  await expect(panelName).toBeVisible();
  await expect(gameName).toHaveValue('Counter-Strike 1.6 ReHLDS Server');
  await panelName.fill('Private panel label');
  await expect(gameName).toHaveValue('Counter-Strike 1.6 ReHLDS Server');
  const ip = page.getByRole('combobox', { name: /Public IP/ });
  const port = page.getByRole('combobox', { name: /Public port/ });
  await expect(ip).toBeVisible();
  await expect(port).toBeVisible();
  const ipBox = (await ip.boundingBox())!;
  const portBox = (await port.boundingBox())!;
  expect(Math.abs(ipBox.y - portBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(ipBox.height - portBox.height)).toBeLessThanOrEqual(1);
});
test('catalog failure offers retry rather than silently switching to community', async ({ page }) => {
  await page.route('**/api/game-templates', r => r.fulfill({ status: 503, json: { error: 'Catalog unavailable' } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/install-picker.fixture.html');
  await expect(page.getByRole('alert')).toContainText('Catalog unavailable');
  await expect(page.getByRole('button', { name: 'Retry templates' })).toBeVisible();
  await expect(page.getByText('Minecraft', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('starting installation replaces the installer, and closing progress returns to servers', async ({ page }) => {
  await page.route('**/api/nodes', r => r.fulfill({ json: { nodes: [] } }));
  await page.route('**/allocations', r => r.fulfill({ json: { network: { allocations: [{ ip: '192.0.2.10', alias: 'Local', udp: '27015-27030', tcp: '' }] } } }));
  await page.route('**/api/servers/available-ports?*', r => r.fulfill({ json: { ports: [27015] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { templatesProtocol: 1, nativeRuntimeProtocol: 1, templateScriptsProtocol: 1, nativeSettingsProtocol: 1 } }));
  await page.route('**/prepare', r => r.fulfill({ json: { ticket: 'test' } }));
  await page.route('**/api/servers/install', r => r.fulfill({ json: { server: { id: 8 } } }));
  await page.route('**/api/servers/8', r => r.fulfill({ json: { server: { installProgress: { progress: 25, status: 'native_step_0' } } } }));
  await page.goto('/test/install-picker.fixture.html');
  await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
  await page.getByRole('combobox', { name: /Public IP/ }).click();
  await page.getByRole('option', { name: /192.0.2.10/ }).click();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Install Game Server', exact: true })).toBeHidden();
  await expect(page.getByLabel('Panel server name', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Catalog', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/native-install-single-modal.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Install Game Server', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
  await expect(page.getByRole('heading', { name: document.name, exact: true })).toBeVisible();
  // Add Game Server always starts a new form, even while another install is active.
  await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Panel server name', { exact: true })).toBeVisible();
});

test('old stored installation does not replace a fresh form or submit a server automatically', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('template-install-test-rehlds-local', JSON.stringify({ id: 8, nodeId: 'local' })));
  let oldStatusRequests = 0;
  let installs = 0;
  await page.route('**/api/servers/8', r => { oldStatusRequests++; return r.fulfill({ json: { server: { installProgress: { progress: 100, status: 'completed' } } } }); });
  await page.route('**/api/servers/install', r => { installs++; return r.fulfill({ json: {} }); });
  await page.route('**/api/nodes', r => r.fulfill({ json: { nodes: [] } }));
  await page.route('**/allocations', r => r.fulfill({ json: { network: { allocations: [] } } }));
  await page.goto('/test/install-picker.fixture.html');
  await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
  await expect(page.getByLabel('Panel server name', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(oldStatusRequests).toBe(0);
  expect(installs).toBe(0);
});

for (const outcome of ['completed', 'failed']) {
  test(`another server can be created from the same template after ${outcome}`, async ({ page }) => {
    await page.route('**/api/nodes', r => r.fulfill({ json: { nodes: [] } }));
    await page.route('**/allocations', r => r.fulfill({ json: { network: { allocations: [{ ip: '192.0.2.10', alias: 'Local', udp: '27015-27030', tcp: '' }] } } }));
    await page.route('**/api/servers/available-ports?*', r => r.fulfill({ json: { ports: [27015, 27016] } }));
    await page.route('**/api/health', r => r.fulfill({ json: { templatesProtocol: 1, nativeRuntimeProtocol: 1, templateScriptsProtocol: 1, nativeSettingsProtocol: 1 } }));
    await page.route('**/prepare', r => r.fulfill({ json: { ticket: 'test' } }));
    const names: string[] = [];
    await page.route('**/api/servers/install', r => {
      names.push(r.request().postDataJSON().name);
      return r.fulfill({ json: { server: { id: 7 + names.length } } });
    });
    await page.route('**/api/servers/8', r => r.fulfill({ json: { server: { installProgress: { progress: 100, status: outcome, errorMessage: outcome === 'failed' ? 'Test failure' : undefined } } } }));
    await page.route('**/api/servers/9', r => r.fulfill({ json: { server: { installProgress: { progress: 25, status: 'native_step_0' } } } }));
    await page.goto('/test/install-picker.fixture.html');
    for (const name of ['First server', 'Second server']) {
      await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
      await page.getByLabel('Panel server name', { exact: true }).fill(name);
      await page.getByRole('combobox', { name: /Public IP/ }).click();
      await page.getByRole('option', { name: /192.0.2.10/ }).click();
      await page.getByRole('button', { name: 'Create server', exact: true }).click();
      if (name === 'First server') {
        await expect(page.getByRole('heading', { name: outcome === 'completed' ? 'Installation completed' : 'Installation failed', exact: true })).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.getByRole('button', { name: 'Add Game Server', exact: true }).click();
      }
    }
    await expect(page.getByRole('heading', { name: 'Installing Second server', exact: true })).toBeVisible();
    expect(names).toEqual(['First server', 'Second server']);
  });
}
