import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
const waw1 = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const waw2 = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const node = (id: string, name: string) => ({
  id,
  name,
  location: 'Warsaw',
  enabled: 1,
  status: 'online',
});
const sockets = new Map<string, WebSocketRoute[]>();
const frame = (cpu: number, time = new Date().toISOString()) =>
  JSON.stringify({
    type: 'system-metrics:update',
    timestamp: time,
    metrics: { cpuUsage: cpu, memoryUsage: 31, diskUsage: 52, network: { in: 1024, out: 2048 } },
  });
async function choose(page: Page, name: string) {
  await page.getByRole('combobox', { name: /^Node scope/ }).click();
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
}
test.beforeEach(async ({ page }) => {
  sockets.clear();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'fixture-token');
    localStorage.setItem('theme', 'dark');
    localStorage.setItem(
      'system_metrics_latest',
      JSON.stringify({ cpu: 99, memory: 99, disk: 99 })
    );
  });
  await page.route('**/api/system/appearance', (r) =>
    r.fulfill({ json: { appearance: { siteName: 'Game Panel PRO' } } })
  );
  await page.route('**/api/nodes', (r) =>
    r.fulfill({
      json: {
        local: { id: 'local', name: 'FR1', location: 'France' },
        nodes: [node(waw1, 'WAW1'), node(waw2, 'WAW2')],
      },
    })
  );
  await page.route('**/api/fleet', (r) =>
    r.fulfill({
      json: {
        servers: [waw1, waw2].map((id, i) => ({
          id: `server-${i}`,
          name: `Arena ${i + 1}`,
          provider: 'native',
          status: 'unknown',
          available: false,
          node: { id, name: 'Same name', location: 'Warsaw' },
        })),
      },
    })
  );
  await page.routeWebSocket(/\/api(?:\/nodes\/[^/]+\/ws)?$/, (ws) => {
    const id = /\/nodes\/([^/]+)\//.exec(ws.url())?.[1] || 'local';
    sockets.set(id, [...(sockets.get(id) || []), ws]);
    ws.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type === 'auth') ws.send(JSON.stringify({ type: 'auth:success' }));
      if (message.type === 'subscribe:system-metrics') {
        ws.send(frame(id === 'local' ? 11 : id === waw1 ? 22 : 33));
      }
    });
  });
});
test('global scope defaults to All, filters by identity and survives changing pages without changing runtime', async ({
  page,
}) => {
  await page.goto('/test/node-scope.fixture.html');
  await expect(page.getByRole('combobox', { name: 'Node scope All nodes' })).toBeVisible();
  await expect(page.getByText('Arena 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Arena 2', { exact: true })).toBeVisible();
  await choose(page, 'WAW2');
  await expect(page.getByText('Arena 1', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Arena 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Host Status$/ }).click();
  await expect(page.getByRole('region', { name: 'WAW2 metrics' })).toContainText('33%');
  await expect(page.getByText('CPU History', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Panel Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Node scope WAW2' })).toBeVisible();
  await choose(page, 'All nodes');
  await page.getByRole('button', { name: /Game Servers$/ }).click();
  await expect(page.getByText('Arena 1', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_active_node'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_admin_runtime'))).toBeNull();
});
test('All hosts have isolated metrics; details replace streams and ignore old cache and old-host events', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/test/node-scope.fixture.html');
  await page.getByRole('button', { name: /Host Status$/ }).click();
  await expect(page.getByRole('region', { name: 'FR1 metrics' })).toContainText('11%');
  await expect(page.getByRole('region', { name: 'WAW1 metrics' })).toContainText('22%');
  await expect(page.getByRole('region', { name: 'WAW2 metrics' })).toContainText('33%');
  await expect(page.getByText('CPU History', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/host-scope-all-dark.png', fullPage: true });
  const old = sockets.get('local')![0];
  await page.getByRole('button', { name: 'View WAW1 details' }).click();
  await expect(page.getByRole('combobox', { name: 'Node scope WAW1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'WAW1 metrics' })).toContainText('22%');
  old.send(frame(99));
  await expect(page.getByText('99%', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'FR1 metrics' })).toHaveCount(0);
  await expect(page.getByText('CPU History', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/host-scope-detail-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await choose(page, 'All nodes');
  await expect(page.getByRole('region', { name: 'FR1 metrics' })).toContainText('11%');
  await page.screenshot({ path: 'test-results/host-scope-all-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: /^Node scope/ }).click();
  await expect(page.getByRole('option', { name: /^WAW2/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/host-scope-mobile.png', fullPage: true });
});
test('broken or silent host never displays zero or cached metrics and can retry independently', async ({
  page,
}) => {
  await page.routeWebSocket(`**/api/nodes/${waw2}/ws`, (ws) => {
    sockets.set(waw2, [ws]);
    ws.onMessage((data) => {
      if (JSON.parse(String(data)).type === 'auth')
        ws.send(JSON.stringify({ type: 'auth:success' }));
    });
  });
  await page.goto('/test/node-scope.fixture.html');
  await page.getByRole('button', { name: /Host Status$/ }).click();
  const unavailable = page.getByRole('region', { name: 'WAW2 metrics' });
  await expect(unavailable).toContainText('Loading host metrics');
  await expect(unavailable.getByText('0%', { exact: true })).toHaveCount(0);
  await expect(unavailable.getByText('99%', { exact: true })).toHaveCount(0);
  sockets.get(waw2)![0].send(JSON.stringify({ type: 'error', error: 'Node unavailable' }));
  await expect(unavailable).toContainText('Host metrics unavailable');
  await expect(page.getByRole('region', { name: 'FR1 metrics' })).toContainText('11%');
  await unavailable.getByRole('button', { name: 'Retry' }).click();
  await expect(unavailable).toContainText('Loading host metrics');
  sockets.get(waw2)![0].send(frame(44));
  await expect(unavailable).toContainText('44%');
});
test('ordinary users do not get the infrastructure selector or node registry', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/nodes', (r) => {
    requests++;
    return r.fulfill({ json: { nodes: [] } });
  });
  await page.addInitScript(() => sessionStorage.setItem('test-player', '1'));
  await page.goto('/test/node-scope.fixture.html');
  await expect(page.getByText('Arena 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Node scope/ })).toHaveCount(0);
  expect(requests).toBe(0);
});
