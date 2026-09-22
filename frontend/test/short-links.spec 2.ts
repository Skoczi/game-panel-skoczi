import { test, expect } from '@playwright/test';
const nodeId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const context = {
  id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  displayId: 'SRV-18',
  nodeId,
  runtimeId: 8,
  name: 'Remote Arena',
  location: 'Warsaw',
  nodeName: 'WAW1',
  permissions: ['container.logs.read'],
  placementRevision: 1,
};
test.beforeEach(async ({ page }, testInfo) => {
  await page.route(/\/(?:s\/[^?]*|)(?:\?.*)?$/, async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch({
      url: 'http://127.0.0.1:4178/test/short-links.fixture.html',
    });
    return route.fulfill({ response });
  });
  if (testInfo.title !== 'a short destination survives sign-in')
    await page.addInitScript(() => localStorage.setItem('auth_token', 'test-token'));
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 2, username: 'Player', isRoot: false },
        permissions: { global: [], servers: [] },
      },
    })
  );
  await page.route('**/api/fleet/*/context', (route) => {
    const key = route.request().url().split('/').at(-2);
    return key === '18' || key === context.id
      ? route.fulfill({ json: context })
      : route.fulfill({ status: 404, json: { error: 'Server not found' } });
  });
});
test('cold short links resolve global identity; tabs, refresh and back preserve runtime scoping', async ({
  page,
}) => {
  let remote = 0;
  let local = 0;
  await page.route('**/api/servers/8', (route) => {
    local++;
    return route.fulfill({ json: {} });
  });
  await page.route(`**/api/nodes/${nodeId}/runtime/api/servers/8`, (route) => {
    remote++;
    expect(route.request().headers()['x-gamepanel-server']).toBe(context.id);
    return route.fulfill({ json: {} });
  });
  await page.goto('/s/18/files');
  await expect(page.getByRole('heading')).toHaveText('Remote Arena');
  await expect(page.locator('output')).toHaveText('filemanager');
  await page.getByRole('button', { name: 'Read runtime' }).click();
  await expect.poll(() => remote).toBe(1);
  expect(local).toBe(0);
  await expect(page.getByRole('link', { name: 'backup' })).toHaveAttribute('href', '/s/18/backups');
  await page.getByRole('link', { name: 'backup' }).click();
  await expect(page).toHaveURL(/\/s\/18\/backups$/);
  await page.reload();
  await expect(page.locator('output')).toHaveText('backup');
  await page.goBack();
  await expect(page.locator('output')).toHaveText('filemanager');
  await page.getByRole('button', { name: 'Fleet', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4178/');
  await expect(page.getByRole('heading')).toHaveText('Fleet');
});
test('legacy UUID links canonicalize without losing the selected tab or trusting cached placement', async ({
  page,
}) => {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      sessionStorage.setItem(
        'gamepanel_active_server',
        JSON.stringify({ ...value, nodeId: 'local', runtimeId: 8, displayId: undefined })
      );
    }
  }, context);
  await page.goto(`/?server=${context.id}#/nodes/${nodeId}/servers/8/filemanager`);
  await expect(page).toHaveURL(/\/s\/18\/files$/);
  await expect(page.locator('output')).toHaveText('filemanager');
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('gamepanel_active_server')!).nodeId)
  ).toBe(nodeId);
});
test('missing, forbidden and malformed short links fail closed instead of opening a cached server', async ({
  page,
}) => {
  for (const path of ['/s/999/files', '/s/0/files', '/s/9007199254740992/files']) {
    await page.goto(path);
    await expect(page).toHaveURL('http://127.0.0.1:4178/');
    await expect(page.getByRole('heading')).toHaveText('Fleet');
  }
});
test('a short destination survives sign-in', async ({ page }) => {
  await page.goto('/s/18/settings');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('output')).toHaveText('containerconfig');
  await expect(page).toHaveURL(/\/s\/18\/settings$/);
});
