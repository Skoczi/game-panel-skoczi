import { test, expect, type Page } from '@playwright/test';
async function select(page: Page, name: string, option: string) {
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
test('global IDs, premium views and quick consoles stay scoped across identical local IDs', async ({
  page,
}) => {
  const second = servers[1].id;
  const mutations: { url: string; scope: string }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'test-token');
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
  await expect(page.getByText('SRV-1', { exact: true })).toBeVisible();
  await expect(page.getByText('12.3%')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/fleet-premium-cards-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('button', { name: 'Table view' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const first = page.getByRole('article').filter({ hasText: 'Community Arena' });
  const other = page.getByRole('article').filter({ hasText: 'Survival World' });
  await first.getByRole('button', { name: 'Quick console', exact: true }).click();
  await expect(page.getByText('FIRST NODE LOG', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Quick console', exact: true }).click();
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
  await expect(page.getByRole('combobox', { name: 'Filter by game type' })).toContainText(
    'mcserver'
  );
  await expect(page.getByRole('combobox', { name: 'Group servers' })).toContainText('Game / type');
  await page.evaluate(() => sessionStorage.setItem('test-user', '3'));
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Filter by game type' })).toContainText(
    'All types'
  );
  await page.evaluate(() => sessionStorage.setItem('test-user', '2'));
  await page.reload();
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
test('users get one workspace with locations, no node selector or infrastructure menu', async ({
  page,
}) => {
  await page.goto('/test/fleet.fixture.html');
  await expect(page.getByRole('heading', { name: 'Community Arena' })).toBeVisible();
  await expect(
    page.locator('.gp-fleet-location').filter({ hasText: 'Amsterdam, NL' })
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Execution node/ })).toHaveCount(0);
  for (const name of ['Nodes', 'Manage nodes', 'Host Status', 'Settings', 'User Administration'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByText('The game may still be running.', { exact: false })).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .filter({ hasText: 'Survival World' })
      .getByRole('button', { name: 'Open server' })
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
    .getByRole('button', { name: 'Open server' })
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
  await page.goto('/test/fleet.fixture.html');
  await page.getByRole('button', { name: 'Access for Community Arena' }).click();
  await page.getByRole('combobox', { name: 'User', exact: true }).click();
  await page.getByRole('option', { name: 'Player', exact: true }).click();
  const accessDialog = page.locator('.gp-fleet-access-modal');
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
    .getByRole('button', { name: 'Open server' })
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
