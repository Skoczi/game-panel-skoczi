import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('gamepanel_admin_runtime', '1');
    sessionStorage.setItem('gamepanel_active_node', 'local');
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.endsWith('/files/roots'))
      return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (url.pathname.endsWith('/file'))
      return route.fulfill({ json: { content: 'hostname test' } });
    if (url.pathname.endsWith('/files'))
      return route.fulfill({ json: { entries: [{ name: 'server.cfg', type: 'file' }] } });
    return route.fulfill({ json: { nodes: [], entries: [], settings: {} } });
  });
});
test('Manage opens a real server page; tabs, refresh and browser back retain context', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/test/server-page.fixture.html');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await expect(page).toHaveURL(/servers\/7\/console$/);
  await expect(page.getByRole('heading', { name: 'CS16 Test', exact: true })).toBeVisible();
  await expect(page.getByText('Server ready for players')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Game Config', exact: true }).click();
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Network', exact: true }).click();
  await expect(page.getByRole('cell', { name: '27015', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to servers' }).click();
  await expect(page.getByRole('button', { name: 'Manage', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('console and power are permission gated including direct URLs', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html?restricted#/nodes/local/servers/7/console');
  await expect(page.getByText("You don't have permission to read the console.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Files', exact: true })).toHaveCount(0);
  await page.goto('/test/server-page.fixture.html?restricted#/nodes/local/servers/7/filemanager');
  await expect(page.getByText('No access to this section.')).toBeVisible();
  expect(await page.evaluate(() => (window as any).actions || [])).toEqual([]);
});
test('power confirmation and console page responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Restart server', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).actions.some((a: any) => a.id === '7' && a.action === 'restart')
    )
  ).toBe(true);
  await page.screenshot({ path: 'test-results/server-page-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'CS16 Test', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Files', exact: true }).click();
  await expect(page.getByText('server.cfg', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/server-page-mobile-files.png', fullPage: true });
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
test('a URL for a different node never exposes the same numeric server on this node', async ({
  page,
}) => {
  await page.goto(
    '/test/server-page.fixture.html#/nodes/11111111-1111-1111-1111-111111111111/servers/7/console'
  );
  await expect(page.getByRole('heading', { name: 'Server unavailable' })).toBeVisible();
  await expect(page.getByText('Server ready for players')).toHaveCount(0);
});

test('unsaved files are protected when leaving by tabs and browser history', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  await page.getByRole('link', { name: 'Files', exact: true }).click();
  await page.getByText('server.cfg', { exact: true }).dblclick();
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill('hostname edited');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Console', exact: true }).click();
  await expect(page).toHaveURL(/filemanager$/);
  await expect(editor).toContainText('hostname edited');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/filemanager$/);
  await expect(editor).toContainText('hostname edited');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'Console', exact: true }).click();
  await expect(page.getByText('Server ready for players')).toBeVisible();
});

test('light theme keeps the configuration page readable and scrollable', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/gameconfig');
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.screenshot({ path: 'test-results/server-page-light-config.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
