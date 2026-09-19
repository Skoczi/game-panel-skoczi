import { test, expect } from '@playwright/test';

test('console height is independent, persisted, and moves charts beside a tall console', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.addInitScript(() => localStorage.setItem('gp_console_height', '900'));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  const panel = page.locator('.gp-console-panel');
  expect((await panel.boundingBox())!.height).toBeGreaterThan(490);
  expect((await panel.boundingBox())!.height).toBeLessThan(560);
  const handle = page.getByRole('separator', { name: 'Resize console' });
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 450, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.gp-server-overview')).toHaveClass(/gp-server-overview-tall/);
  const charts = page.locator('.gp-server-charts');
  expect((await charts.boundingBox())!.x).toBeGreaterThan((await panel.boundingBox())!.x + 500);
  await page.screenshot({ path: 'test-results/server-console-tall.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.gp-server-overview')).toHaveClass(/gp-server-overview-tall/);
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(panel).toHaveAttribute('data-fullscreen', 'true');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('data-fullscreen', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => Math.abs((await charts.boundingBox())!.x - (await panel.boundingBox())!.x))
    .toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['light', 'dark']) {
  test(`metrics cards are compact and chart tooltips are readable in ${theme} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark'
    );
    const card = page.locator('.gp-server-stats .gp-server-stat').nth(1);
    expect((await card.boundingBox())!.height).toBeLessThan(120);
    for (const index of [0, 2]) {
      const chart = page.locator('.gp-server-charts .recharts-wrapper').nth(index);
      await chart.scrollIntoViewIfNeeded();
      const box = (await chart.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const tooltip = page.locator('.gp-metric-tooltip');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(index === 0 ? 'CPU usage' : 'Inbound');
      await expect(tooltip).toContainText(index === 0 ? '%' : 'B/s');
      if (index === 2) await expect(tooltip).toContainText('Outbound');
      const contrast = await tooltip.evaluate((element) => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              const c = v / 255;
              return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const bg = luminance(getComputedStyle(element).backgroundColor);
        return [...element.querySelectorAll('time, span, strong')].map((child) => {
          const fg = luminance(getComputedStyle(child).color);
          return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
        });
      });
      expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: `test-results/server-metrics-${theme}.png`, fullPage: true });
  });
}

for (const tab of ['scheduledtasks', 'backup', 'containerconfig']) {
  for (const width of [1920, 390]) {
    test(`${tab} fills the page content at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/test/server-page.fixture.html#/nodes/local/servers/7/${tab}`);
      const body = page.locator('.gp-server-page-content .gp-server-settings-body');
      await expect(body).toBeVisible();
      expect(await body.evaluate((element) => {
        let current = element.parentElement;
        while (current?.closest('.gp-server-page-content')) {
          if (current.scrollHeight > current.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(current).overflowY)) return true;
          current = current.parentElement;
        }
        return false;
      })).toBe(false);
      const dimensions = await body.evaluate((element) => {
        const parent = element.parentElement!;
        const style = getComputedStyle(parent);
        return {
          actual: element.getBoundingClientRect().width,
          available:
            parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          maxWidth: getComputedStyle(element).maxWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(dimensions.maxWidth).toBe('none');
      expect(Math.abs(dimensions.actual - dimensions.available)).toBeLessThan(2);
      expect(dimensions.overflow).toBe(false);
      await page.screenshot({
        path: `test-results/server-page-${tab}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

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
  await expect(page.getByRole('heading', { name: 'Different execution node' })).toBeVisible();
  await expect(page.getByText('Server ready for players')).toHaveCount(0);
});

test('loading uses a responsive skeleton without flashing an unavailable error', async ({
  page,
}) => {
  await page.goto('/test/server-page.fixture.html?snapshot=loading#/nodes/local/servers/7/console');
  await expect(page.getByRole('heading', { name: 'Opening your server' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Server unavailable' })).toHaveCount(0);
  await expect(page.locator('.gp-server-skeleton')).toBeVisible();
  await expect(page.locator('.gp-server-state')).toHaveAttribute('aria-busy', 'true');
  await page.screenshot({ path: 'test-results/server-loading-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.locator('.gp-server-skeleton').evaluate((el) => getComputedStyle(el).animationName)
  ).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/server-loading-mobile.png', fullPage: true });
});

for (const state of ['error', 'missing']) {
  test(`${state} has a distinct message and retry can recover`, async ({ page }) => {
    await page.goto(
      `/test/server-page.fixture.html?snapshot=${state}#/nodes/local/servers/7/console`
    );
    await expect(
      page.getByRole('heading', {
        name: state === 'error' ? 'Unable to connect' : 'Server unavailable',
      })
    ).toBeVisible();
    await expect(page.locator('.gp-server-skeleton')).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'CS16 Test', exact: true })).toBeVisible();
  });
}

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
