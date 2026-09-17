import { test, expect } from '@playwright/test';
const nodeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const serverId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const servers = [
  {
    id: serverId,
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
test('view filters, grouping and sort persist per account and can be reset', async ({ page }) => {
  await page.goto('/test/fleet.fixture.html');
  await page.getByRole('combobox', { name: 'Group servers' }).selectOption('type');
  await expect(page.getByRole('heading', { name: 'Custom image', exact: false })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Filter by game type' })
    .selectOption('linuxgsm:mcserver');
  await expect(page.getByRole('heading', { name: 'Community Arena', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Survival World', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort servers' }).selectOption('name');
  await expect(page.getByRole('button', { name: 'Reorder Survival World' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Filter by game type' })).toHaveValue(
    'linuxgsm:mcserver'
  );
  await expect(page.getByRole('combobox', { name: 'Group servers' })).toHaveValue('type');
  await page.evaluate(() => sessionStorage.setItem('test-user', '3'));
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Filter by game type' })).toHaveValue('');
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
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('running');
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
  await expect.poll(() => remote).toBe(1);
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
  await page.getByRole('combobox', { name: 'User', exact: true }).selectOption('2');
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
