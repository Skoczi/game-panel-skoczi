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
    status: 'unknown',
    available: false,
    observedAt: Date.now() - 90000,
    node: { name: 'North-02', location: 'Helsinki, FI' },
  },
];
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
