import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const document = JSON.parse(readFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8'));
const row = { id: 'test-rehlds', version: 3, status: 'published', document, hash: 'a'.repeat(64), actor: 'test', created_at: '' };
const nodeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
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
  await page.route('**/allocations', r => { allocations.push(r.request().url()); return r.fulfill({ json: { network: { allocations: [] } } }); });
  await page.goto('/test/install-picker.fixture.html');
  await page.getByRole('button', { name: `Install ${document.name}`, exact: true }).click();
  await expect(page.getByText('Execution node: WAW1', { exact: true })).toBeVisible();
  await expect.poll(() => allocations.length).toBeGreaterThan(0);
  expect(allocations.every(url => url.includes(`/nodes/${nodeId}/`))).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Execution node' })).toHaveCount(0);
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
