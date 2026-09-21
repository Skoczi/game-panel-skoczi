import { test, expect } from '@playwright/test';
const node = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const globalServer = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('test-local-initialized')) return;
    sessionStorage.setItem('test-local-initialized', '1');
    sessionStorage.setItem('gamepanel_admin_runtime', '1');
    sessionStorage.setItem('gamepanel_active_node', 'local');
  });
  await page.route('**/api/**', route => !new URL(route.request().url()).pathname.startsWith('/api/') ? route.continue() : route.fulfill({ json: { server: { id: 7, name: 'CS16 Test', status: 'running', ports: { tcp: [], udp: [] }, mounts: [], env: {} }, nodes: [], settings: {} } }));
});
for (const remote of [false, true]) test(`Settings deletes only the confirmed server and returns to fleet; remote=${remote}`, async ({ page }) => {
  if (remote) await page.addInitScript(({ node, globalServer }) => {
    if (location.pathname !== '/test/server-page.fixture.html' || sessionStorage.getItem('test-remote-initialized')) return;
    sessionStorage.setItem('test-remote-initialized', '1');
    sessionStorage.removeItem('gamepanel_admin_runtime');
    sessionStorage.setItem('gamepanel_active_server', JSON.stringify({ id: globalServer, nodeId: node, runtimeId: 7, name: 'CS16 Test', nodeName: 'WAW2', location: 'Warsaw', permissions: ['*'], placementRevision: 1 }));
  }, { node, globalServer });
  const writes: Array<{ url: string; headers: Record<string,string> }> = [];
  await page.route('**/api/servers/7', async route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    writes.push({ url: route.request().url(), headers: route.request().headers() });
    await route.fulfill({ json: { success: true } });
  });
  await page.goto(`/test/server-page.fixture.html#/nodes/${remote ? node : 'local'}/servers/7/containerconfig`);
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Startup & Settings', { exact: true })).toHaveCount(0);
  await page.getByRole('region', { name: 'Delete server' }).getByRole('button', { name: 'Delete server', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete server?' });
  const confirm = dialog.getByRole('button', { name: 'Delete server', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('region', { name: 'Delete server' }).getByRole('button').click();
  await dialog.getByPlaceholder('CS16 Test').fill('wrong name');
  await expect(confirm).toBeDisabled();
  await dialog.getByPlaceholder('CS16 Test').fill('CS16 Test');
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await dialog.screenshot({ path: `test-results/delete-confirm-${remote ? 'remote' : 'local'}.png` });
  await confirm.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(new URL(writes[0].url).pathname).toBe(`${remote ? '/api/nodes/'+node+'/runtime' : ''}/api/servers/7`);
  if (remote) expect(writes[0].headers['x-gamepanel-server']).toBe(globalServer);
  await expect(page).not.toHaveURL(/servers\/7/);
  if (remote) {
    await page.route('**/api/fleet', route => route.fulfill({ json: { servers: [
      { id: globalServer, name: 'Stale deleted server', provider: 'external', status: 'running', available: true, observedAt: Date.now(), node: { name: 'WAW2' } },
      { id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc', name: 'Other server', provider: 'external', status: 'running', available: true, observedAt: Date.now(), node: { name: 'WAW1' } },
    ] } }));
    await page.goto('/test/fleet.fixture.html');
    await expect(page.getByText('Other server', { exact: true })).toBeVisible();
    await expect(page.getByText('Stale deleted server', { exact: true })).toHaveCount(0);
  }
});

test('read-only users cannot delete; delete-only grants do not enable editing', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html?restricted#/nodes/local/servers/7/containerconfig');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Delete server' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/server-page.fixture.html?deleteOnly#/nodes/local/servers/7/containerconfig');
  await expect(page.getByRole('region', { name: 'Delete server' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save container config' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.getByRole('region', { name: 'Delete server' }).screenshot({ path: 'test-results/delete-section-mobile.png' });
});
for (const status of [403, 503]) test(`deletion error ${status} keeps the server page and does not retry`, async ({ page }) => {
  let writes = 0;
  await page.route('**/api/servers/7', route => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    writes++;
    return route.fulfill({ status, json: { error: 'Deletion rejected' } });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/containerconfig');
  await page.getByRole('region', { name: 'Delete server' }).getByRole('button').click();
  const dialog = page.getByRole('dialog', { name: 'Delete server?' });
  await dialog.getByPlaceholder('CS16 Test').fill('CS16 Test');
  await dialog.getByRole('button', { name: 'Delete server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(status === 503 ? 'Deletion could not be confirmed' : 'Deletion rejected');
  await expect(page).toHaveURL(/containerconfig/);
  expect(writes).toBe(1);
  if (status === 503) await expect(page.getByRole('region', { name: 'Delete server' }).getByRole('button', { name: 'Delete server', exact: true })).toBeDisabled();
});
