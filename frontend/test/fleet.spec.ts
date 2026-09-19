import { test, expect, type Page } from '@playwright/test';
async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}
async function select(page: Page, name: string, option: string) {
  await openFilters(page);
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
const nodeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const serverId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const servers = [
  {
    id: serverId,
    displayId: 'SRV-1',
    name: 'Community Arena',
    provider: 'external',
    status: 'running',
    available: true,
    observedAt: Date.now(),
    node: { name: 'West-01', location: 'Amsterdam, NL' },
  },
  {
    id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
    name: 'Survival World',
    provider: 'linuxgsm',
    catalogId: 'mcserver',
    status: 'unknown',
    available: false,
    observedAt: Date.now() - 90000,
    node: { name: 'North-02', location: 'Helsinki, FI' },
  },
];
test('fleet metric modals and action history are scoped to the selected server', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('auth_token', 'fixture-token'));
  const requested: string[] = [];
  await page.route('**/api/servers/1/metrics?limit=2000', (r) => {
    requested.push(r.request().headers()['x-gamepanel-server']);
    return r.fulfill({
      json: {
        serverId: 1,
        metrics: [0, 1, 2].map((i) => ({
          timestamp: new Date(Date.now() - (2 - i) * 10000).toISOString(),
          cpuUsage: 12 + i,
          memoryUsage: 24,
          diskUsage: 8,
          network: { in: 512, out: 256 },
        })),
      },
    });
  });
  await page.routeWebSocket(/\/api\/nodes\//, (ws) => {
    expect(ws.url()).toContain(`server=${serverId}`);
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'auth') ws.send(JSON.stringify({ type: 'auth:success' }));
      if (message.type === 'subscribe:actions') {
        ws.send(
          JSON.stringify({
            type: 'actions:history',
            serverId: 999,
            actions: [
              {
                id: 1,
                level: 'info',
                message: 'WRONG SERVER',
                timestamp: new Date().toISOString(),
              },
            ],
          })
        );
        ws.send(
          JSON.stringify({
            type: 'actions:history',
            serverId: 1,
            actions: [
              {
                id: 2,
                level: 'success',
                message: 'Scoped server started',
                actorUsername: 'Admin',
                timestamp: new Date().toISOString(),
              },
            ],
          })
        );
      }
    });
  });
  await page.goto('/test/fleet.fixture.html');
  await page.getByRole('button', { name: 'Open CPU history for Community Arena' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'Server Metrics' })).toBeVisible();
  await expect(modal.locator('[aria-label="CPU history chart"]')).toBeVisible();
  expect(requested).toEqual([serverId]);
  for (const metric of ['Memory', 'Disk', 'Network']) {
    await modal.getByRole('button', { name: metric, exact: true }).click();
    await expect(modal.locator(`[aria-label="${metric} history chart"]`)).toBeVisible();
  }
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'test-results/fleet-metrics-dark.png', animations: 'disabled' });
  const close = modal.locator('[data-part="close-trigger"]');
  await expect(close).toHaveCSS('width', '44px');
  await expect(close).toHaveCSS('height', '44px');
  await expect(close).toHaveCSS('right', '20px');
  await expect(close).toHaveCSS('top', '16px');
  await close.click();
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: 'List view' }).click();
  await page.getByRole('button', { name: 'Open Memory history for Community Arena' }).click();
  await expect(modal.getByRole('button', { name: 'Memory', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open history logs for Community Arena' }).click();
  await expect(modal.getByText('[Admin] Scoped server started')).toBeVisible();
  await expect(page.getByText('WRONG SERVER')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/fleet-actions-dark.png', animations: 'disabled' });
});

test('metrics errors can recover and empty history is not fabricated', async ({ page }) => {
  let fail = true;
  await page.route('**/api/servers/1/metrics?limit=2000', (r) =>
    r.fulfill({
      status: fail ? 503 : 200,
      json: fail ? { error: 'Node offline' } : { serverId: 1, metrics: [] },
    })
  );
  await page.goto('/test/fleet.fixture.html');
  await page.getByRole('button', { name: 'Open Network history for Community Arena' }).click();
  await expect(page.getByRole('alert')).toContainText('Node offline');
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('No metrics history available yet for this server.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog').locator('[data-part="close-trigger"]')).toHaveCSS(
    'right',
    '12px'
  );
  await expect(page.getByRole('dialog').locator('[data-part="close-trigger"]')).toHaveCSS(
    'top',
    '12px'
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/fleet-metrics-empty-mobile.png' });
});

test('header sorting toggles direction and persists while clipboard copies the full address', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value: string) => {
          (window as any).copiedAddress = value;
        },
      },
    })
  );
  await page.route('**/api/servers/1', (r) =>
    r.fulfill({
      json: {
        server: {
          id: 1,
          name: 'Community Arena',
          status: 'running',
          ports: { udp: [{ hostIp: '192.0.2.5', host: 27015 }] },
        },
      },
    })
  );
  await page.goto('/test/fleet.fixture.html');
  await page
    .getByRole('button', { name: 'Copy connection address for Community Arena', exact: true })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).copiedAddress)).toBe('192.0.2.5:27015');
  await page.getByRole('button', { name: 'List view' }).click();
  const names = page.locator('tbody tr td:first-child');
  for (const column of ['Server name', 'Game', 'Status']) {
    const header = page.getByRole('columnheader', { name: new RegExp(`^${column}`) });
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(names).toHaveText(['Community Arena', 'Survival World']);
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(names).toHaveText(['Survival World', 'Community Arena']);
  }
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /^Status/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  );
});

test('inline rename checks fresh permission and sends only the scoped name patch', async ({
  page,
}) => {
  let permissions = ['server.edit'];
  const writes: unknown[] = [];
  await page.route(`**/api/fleet/${serverId}/context`, (r) =>
    r.fulfill({ json: { id: serverId, runtimeId: 1, nodeId, permissions, placementRevision: 1 } })
  );
  await page.route('**/api/servers/1', (r) => {
    if (r.request().method() === 'PATCH') {
      expect(r.request().headers()['x-gamepanel-server']).toBe(serverId);
      expect(r.request().url()).toContain(`/nodes/${nodeId}/runtime/`);
      writes.push(r.request().postDataJSON());
      return r.fulfill({ json: { server: { id: 1, name: 'Renamed Arena' } } });
    }
    return r.fulfill({ json: { server: { id: 1, name: 'Community Arena', status: 'running' } } });
  });
  await page.goto('/test/fleet.fixture.html');
  await page.getByRole('button', { name: 'Edit name for Community Arena' }).click();
  await page.getByRole('textbox', { name: 'Server name', exact: true }).fill('Cancelled');
  await page.keyboard.press('Escape');
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Edit name for Community Arena' }).click();
  await page.getByRole('textbox', { name: 'Server name', exact: true }).fill('Renamed Arena');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit name for Renamed Arena' })).toBeVisible();
  expect(writes).toEqual([{ name: 'Renamed Arena' }]);
  await page.getByRole('button', { name: 'Edit name for Renamed Arena' }).click();
  permissions = [];
  await page.getByRole('textbox', { name: 'Server name', exact: true }).fill('Forbidden rename');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('no longer have permission');
  expect(writes).toHaveLength(1);
});
test('global IDs, premium views and quick consoles stay scoped across identical local IDs', async ({
  page,
}) => {
  const second = servers[1].id;
  const mutations: { url: string; scope: string }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
    sessionStorage.setItem('test-admin', '1');
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/fleet', (r) =>
    r.fulfill({
      json: {
        servers: [
          servers[0],
          { ...servers[1], displayId: 'SRV-2', status: 'running', available: true },
        ],
      },
    })
  );
  for (const [id, node, number] of [
    [serverId, nodeId, 1],
    [second, 'local', 2],
  ] as const) {
    await page.route(`**/api/fleet/${id}/context`, (r) =>
      r.fulfill({
        json: {
          id,
          displayId: `SRV-${number}`,
          nodeId: node,
          runtimeId: 1,
          permissions: ['server.power', 'container.logs.read', 'server.command.send'],
          placementRevision: 1,
        },
      })
    );
  }
  await page.route('**/api/servers/1**', (r) => {
    if (r.request().method() === 'POST') {
      mutations.push({
        url: r.request().url(),
        scope: r.request().headers()['x-gamepanel-server'],
      });
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({
      json: r.request().url().includes('/metrics')
        ? { metrics: [{ cpuUsage: 12.3, memoryUsage: 24.5 }] }
        : {
            server: {
              id: 1,
              name: 'Arena',
              status: 'running',
              provider: 'native',
              ports: { udp: [{ hostIp: '192.0.2.10', host: 27015 }] },
              providerMetadata: { template: { document: { schemaVersion: 2 } } },
            },
          },
    });
  });
  const sockets: string[] = [];
  await page.routeWebSocket(/\/api(?:\?|\/nodes\/)/, (ws) => {
    sockets.push(ws.url());
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'auth') ws.send(JSON.stringify({ type: 'auth:success' }));
      if (message.type === 'subscribe:logs')
        ws.send(
          JSON.stringify({
            type: 'logs:history',
            serverId: 1,
            logs: [ws.url().includes(second) ? 'SECOND NODE LOG' : 'FIRST NODE LOG'],
          })
        );
    });
  });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/test/fleet.fixture.html');
  await expect(page.getByText('SRV-1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByRole('combobox', { name: 'Sort servers' })).toHaveCount(0);
  await expect(page.locator('.fleet-node-title')).toContainText('2/2 servers');
  await expect(page.getByText('Drag the handle to reorder.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Game Server', exact: true })).toHaveCount(1);
  await expect(
    page.locator('header').getByRole('button', { name: 'Add Game Server', exact: true })
  ).toBeVisible();
  await select(page, 'Group servers', 'Game / type');
  await expect(page.getByRole('button', { name: 'Add Game Server', exact: true })).toHaveCount(1);
  await select(page, 'Group servers', 'No grouping');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByText('12.3%')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/fleet-premium-cards-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.getByRole('button', { name: 'Add Game Server', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const first = page.getByRole('row').filter({ hasText: 'Community Arena' });
  const other = page.getByRole('row').filter({ hasText: 'Survival World' });
  await first.getByRole('button', { name: 'Log/Console', exact: true }).click();
  await expect(page.getByText('FIRST NODE LOG', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Log/Console', exact: true }).click();
  await expect(page.getByText('SECOND NODE LOG', { exact: true })).toBeVisible();
  await expect(page.getByText('FIRST NODE LOG', { exact: true })).not.toBeVisible();
  expect(
    sockets.some((url) => url.includes(`/nodes/${nodeId}/ws?server=${serverId}`))
  ).toBeTruthy();
  expect(sockets.some((url) => url.includes(`/api?server=${second}`))).toBeTruthy();
  expect(mutations).toHaveLength(0);
  const command = page.getByPlaceholder('Type a command and press Enter…');
  await command.fill('status');
  await command.press('Enter');
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0].scope).toBe(second);
  expect(new URL(mutations[0].url).pathname).toBe('/api/servers/1/console/commands');
  await first.getByRole('button', { name: 'restart Community Arena', exact: true }).click();
  expect(mutations).toHaveLength(1);
  await page.getByRole('dialog').getByRole('button', { name: 'restart', exact: true }).click();
  await expect.poll(() => mutations.length).toBe(2);
  expect(mutations[1].scope).toBe(serverId);
  expect(new URL(mutations[1].url).pathname).toBe(
    `/api/nodes/${nodeId}/runtime/api/servers/1/restart`
  );
  await page.screenshot({ path: 'test-results/fleet-premium-list-dark.png', fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await expect(page.locator('.gp-fleet')).toHaveCSS('color', 'rgb(23, 35, 61)');
  await page.screenshot({ path: 'test-results/fleet-premium-list-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/fleet-premium-mobile.png', fullPage: true });
});
test('custom dropdown supports keyboard, typeahead, cancellation and focus', async ({ page }) => {
  await page.goto('/test/fleet.fixture.html');
  await openFilters(page);
  const sort = page.getByRole('combobox', { name: 'Sort servers' });
  await sort.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('listbox')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Status', exact: true })).toHaveAttribute(
    'data-highlighted',
    ''
  );
  await page.keyboard.press('Enter');
  await expect(sort).toContainText('Status');
  await expect(sort).toBeFocused();
  await sort.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await expect(sort).toContainText('Status');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(sort).toBeFocused();
  await sort.press('n');
  await expect(sort).toContainText('Name A–Z');
  await sort.click();
  await page.getByRole('heading', { name: 'Game Servers', exact: true }).click();
  await expect(sort).toHaveAttribute('aria-expanded', 'false');
  await sort.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Group servers' })).toBeFocused();
});

test('open custom menus fit mobile and dark desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/test/fleet.fixture.html');
  await openFilters(page);
  await page.getByRole('combobox', { name: 'Sort servers' }).click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/fleet-select-mobile.png', fullPage: true });
  await page.getByRole('option', { name: 'Location', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Sort servers' })).toContainText('Location');
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await openFilters(page);
  await page.getByRole('combobox', { name: 'Sort servers' }).click();
  await expect(page.getByRole('option', { name: 'Location', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await page.screenshot({ path: 'test-results/fleet-select-dark.png', fullPage: true });
});

test('view filters, grouping and sort persist per account and can be reset', async ({ page }) => {
  await page.goto('/test/fleet.fixture.html');
  await select(page, 'Group servers', 'Game / type');
  await expect(page.getByRole('heading', { name: 'Custom image', exact: false })).toBeVisible();
  await select(page, 'Filter by game type', 'mcserver');
  await expect(page.getByRole('heading', { name: 'Community Arena', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Survival World', exact: true })).toBeVisible();
  await select(page, 'Sort servers', 'Name A–Z');
  await expect(page.getByRole('button', { name: 'Reorder Survival World' })).toBeDisabled();
  await page.reload();
  await openFilters(page);
  await expect(page.getByRole('combobox', { name: 'Filter by game type' })).toContainText(
    'mcserver'
  );
  await expect(page.getByRole('combobox', { name: 'Group servers' })).toContainText('Game / type');
  await page.evaluate(() => sessionStorage.setItem('test-user', '3'));
  await page.reload();
  await openFilters(page);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Filter by game type' })).toContainText(
    'All types'
  );
  await page.evaluate(() => sessionStorage.setItem('test-user', '2'));
  await page.reload();
  await openFilters(page);
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('keyboard and pointer reorder cards and retain custom order after reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/test/fleet.fixture.html');
  const headings = page.locator('.gp-fleet-card h3');
  await expect(headings).toHaveText(['Community Arena', 'Survival World']);
  const handle = page.getByRole('button', { name: 'Reorder Community Arena' });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.gp-fleet-card.is-dragging')).toHaveCount(1);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  await page.keyboard.press('ArrowRight');
  await expect(
    page.locator('[role="status"]').filter({ hasText: 'Over server Survival World.' })
  ).toHaveCount(1);
  await page.keyboard.press('Space');
  await expect(headings).toHaveText(['Survival World', 'Community Arena']);
  await page.reload();
  await expect(headings).toHaveText(['Survival World', 'Community Arena']);
  const from = (await page.getByRole('button', { name: 'Reorder Survival World' }).boundingBox())!;
  const to = (await page.getByRole('button', { name: 'Reorder Community Arena' }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(headings).toHaveText(['Community Arena', 'Survival World']);
});

test('damaged preferences and unavailable stored filters remain recoverable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gamepanel_fleet_layout_v1:2', '{broken'));
  await page.goto('/test/fleet.fixture.html');
  await expect(page.getByRole('article')).toHaveCount(2);
  await select(page, 'Filter by status', 'running');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('alert')).toContainText('Browser storage is unavailable');
  await expect(page.getByRole('article')).toHaveCount(2);
});

test('touch handle reorders cards on mobile without a desktop pointer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/test/fleet.fixture.html');
  const handles = page.getByRole('button', { name: /^Reorder / });
  await expect(handles).toHaveCount(2);
  await handles.first().scrollIntoViewIfNeeded();
  const from = (await handles.first().boundingBox())!,
    to = (await handles.nth(1).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = from.x + from.width / 2,
    y = from.y + from.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + ((to.y - from.y) * i) / 12 }],
    });
  await expect(page.locator('.gp-fleet-card.is-dragging')).toHaveCount(1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.gp-fleet-card h3')).toHaveText(['Survival World', 'Community Arena']);
  await cdp.detach();
});

test('long catalogue identifiers and empty filters fit narrow grouped layouts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route('**/api/fleet', (r) =>
    r.fulfill({ json: { servers: [{ ...servers[0], catalogId: 'a'.repeat(256) }] } })
  );
  await page.goto('/test/fleet.fixture.html');
  await select(page, 'Group servers', 'Game / type');
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('textbox', { name: 'Search servers and locations' }).fill('no such game');
  await expect(page.getByRole('heading', { name: 'No matching servers' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
});
test.beforeEach(async ({ page }) => {
  await page.route('**/api/branding', (r) =>
    r.fulfill({ json: { siteName: 'Arena', showFollowUs: false, showTrustpilot: false } })
  );
  await page.route('**/api/system/update/check', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/fleet', (r) => r.fulfill({ json: { servers } }));
  await page.route(`**/api/fleet/${serverId}/context`, (r) =>
    r.fulfill({
      json: {
        id: serverId,
        nodeId,
        runtimeId: 1,
        name: 'Community Arena',
        nodeName: 'West-01',
        location: 'Amsterdam, NL',
        permissions: ['server.power'],
        placementRevision: 1,
      },
    })
  );
});
test('users get one workspace without node metadata or infrastructure menu', async ({ page }) => {
  await page.goto('/test/fleet.fixture.html');
  await expect(page.getByRole('heading', { name: 'Community Arena' })).toBeVisible();
  await expect(page.locator('.fleet-node-location')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Access for/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /Execution node/ })).toHaveCount(0);
  for (const name of ['Nodes', 'Add Game Server', 'Host Status', 'Settings', 'User Administration'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByText('The game may still be running.', { exact: false })).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Survival World' })
      .getByRole('button', { name: 'Manage', exact: true })
  ).toBeDisabled();
  await page.getByRole('textbox', { name: 'Search servers and locations' }).fill('Helsinki');
  await expect(page.getByRole('heading', { name: 'Community Arena' })).toHaveCount(0);
});
test('opening a server automatically binds requests to its node and global identity, with no local fallback', async ({
  page,
}) => {
  let local = 0,
    remote = 0;
  await page.route('**/api/servers/1', (r) => {
    local++;
    return r.fulfill({ json: {} });
  });
  await page.route(`**/api/nodes/${nodeId}/runtime/api/servers/1`, (r) => {
    remote++;
    expect(r.request().headers()['x-gamepanel-server']).toBe(serverId);
    return r.fulfill({ status: 503, json: { error: 'Node unavailable' } });
  });
  await page.goto('/test/fleet.fixture.html');
  await page
    .getByRole('article')
    .filter({ hasText: 'Community Arena' })
    .getByRole('button', { name: 'Manage', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`server=${serverId}`));
  await page.getByRole('button', { name: 'Test server route' }).click();
  await expect.poll(() => remote).toBe(2); // Workspace metrics hydrate the scoped runtime before navigation.
  expect(local).toBe(0);
  await page.getByRole('button', { name: 'All servers' }).click();
  await expect(page.getByRole('heading', { name: 'Game Servers', exact: true })).toBeVisible();
});
test('administrator can assign and revoke scoped server permissions', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('test-admin', '1'));
  let members: any[] = [];
  let saved: any;
  await page.route('**/api/users', (r) =>
    r.fulfill({ json: { users: [{ id: 2, username: 'Player', isRoot: false, isEnabled: true }] } })
  );
  await page.route(`**/api/fleet/${serverId}/members`, (r) =>
    r.fulfill({
      json: {
        members,
        permissions: [
          'server.power',
          'server.command.send',
          'container.logs.read',
          'fs.read',
          'fs.write',
        ],
      },
    })
  );
  await page.route(`**/api/fleet/${serverId}/members/2`, (r) => {
    if (r.request().method() === 'PUT') {
      saved = r.request().postDataJSON();
      members = [{ userId: 2, username: 'Player', permissions: saved.permissions }];
    } else members = [];
    return r.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(
    (id) =>
      sessionStorage.setItem(
        'gamepanel_active_server',
        JSON.stringify({
          id,
          nodeId: 'local',
          runtimeId: 7,
          name: 'CS16 Test',
          location: 'Amsterdam, NL',
          nodeName: 'West-01',
          permissions: ['*'],
          placementRevision: 1,
        })
      ),
    serverId
  );
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  await page.getByRole('combobox', { name: 'User', exact: true }).click();
  await page.getByRole('option', { name: 'Player', exact: true }).click();
  const accessDialog = page.locator('.gp-fleet-access-modal');
  await expect(accessDialog.locator('[data-part="close-trigger"]')).toHaveCSS('width', '44px');
  await expect(accessDialog.getByText('Console & terminal', { exact: true })).toBeVisible();
  await expect(accessDialog.getByLabel('View console logs', { exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(
    accessDialog.locator('.gp-app-modal-footer').getByRole('button', { name: 'Close', exact: true })
  ).toHaveCSS('background-color', 'rgb(17, 28, 48)');
  await page.screenshot({ path: 'test-results/server-access-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Save access' })).toBeVisible();
  expect((await accessDialog.boundingBox())!.width).toBeLessThan(390);
  await page.screenshot({ path: 'test-results/server-access-mobile.png' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.screenshot({ path: 'test-results/server-access-light.png' });
  await page.getByRole('button', { name: 'Operator', exact: true }).click();
  await page.getByRole('button', { name: 'Save access' }).click();
  await expect
    .poll(() => saved?.permissions)
    .toEqual(['server.power', 'server.command.send', 'container.logs.read']);
  await page.getByRole('button', { name: 'Revoke access' }).click();
  await expect(page.getByText('No assigned users. Administrators retain access.')).toBeVisible();
});

test('an open server refreshes grants, retains context on outage and exits after revocation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'fixture-token');
    sessionStorage.setItem('test-session', '1');
  });
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({
      json: {
        user: { id: 2, username: 'Player', isRoot: false, isEnabled: true },
        permissions: { global: [], servers: [] },
      },
    })
  );
  let permissions = ['server.power'];
  let status = 200;
  let requests = 0;
  await page.route(`**/api/fleet/${serverId}/context`, (r) => {
    requests++;
    return r.fulfill({
      status,
      json:
        status === 200
          ? {
              id: serverId,
              nodeId,
              runtimeId: 1,
              name: 'Community Arena',
              nodeName: 'West-01',
              location: 'Amsterdam, NL',
              permissions,
              placementRevision: 1,
            }
          : { error: 'Unavailable' },
    });
  });
  await page.goto('/test/fleet.fixture.html');
  await page
    .getByRole('article')
    .filter({ hasText: 'Community Arena' })
    .getByRole('button', { name: 'Manage', exact: true })
    .click();
  await expect(page.getByTestId('session-permissions')).toContainText('server.power');
  permissions = ['fs.read'];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('session-permissions')).toContainText('fs.read');
  await expect(page.getByTestId('session-permissions')).not.toContainText('server.power');
  status = 503;
  const previous = requests;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => requests).toBeGreaterThan(previous);
  await expect(page).toHaveURL(new RegExp(`server=${serverId}`));
  await expect(page.getByTestId('session-permissions')).toContainText('fs.read');
  status = 404;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Game Servers', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_active_server'))).toBeNull();
});
test('fleet workspace fits mobile and dark desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/fleet.fixture.html');
  await expect(page.getByRole('heading', { name: 'Community Arena' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/fleet-mobile.png', fullPage: true });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Community Arena' })).toBeVisible();
  await page.screenshot({ path: 'test-results/fleet-desktop-dark.png', fullPage: true });
});
