import { test, expect } from '@playwright/test';

test('server header is a compact toolbar and wraps cleanly on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  const heading = page.locator('.gp-server-heading');
  const back = heading.getByRole('button', { name: 'Back to servers' });
  const name = heading.getByRole('heading', { name: 'CS16 Test', exact: true });
  const power = heading.locator('.gp-server-power');
  await expect(name).toBeVisible();
  await expect(
    page.locator('.gp-console-panel').getByText('Server Console', { exact: true })
  ).toBeVisible();
  await expect(heading.locator('.gp-server-game')).toContainText('Counter-Strike 1.6');
  await expect(heading.locator('.gp-server-status')).toHaveCount(0);
  await expect(page.locator('.gp-server-stats .gp-server-status')).toHaveText('Running');
  await expect(page.locator('.gp-server-stats')).toContainText('1d 4h 9m');
  await expect(page.getByText(/SERVER MANAGEMENT/)).toHaveCount(0);
  expect((await heading.boundingBox())!.height).toBeLessThan(65);
  const backBox = (await back.boundingBox())!;
  expect(backBox.height).toBeLessThanOrEqual(38);
  await expect(back).toHaveCSS('font-size', '14px');
  for (const button of await power.getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeLessThanOrEqual(38);
  }
  const nameBox = (await name.boundingBox())!;
  const gameBox = (await heading.locator('.gp-server-game').boundingBox())!;
  expect(gameBox.x - (nameBox.x + nameBox.width)).toBeCloseTo(7, 0);
  await expect(heading.locator('.gp-server-titles')).toHaveCSS('align-items', 'baseline');
  const powerBox = (await power.boundingBox())!;
  expect(nameBox.x).toBeGreaterThan(backBox.x + backBox.width);
  expect(powerBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
  expect(Math.abs(backBox.y - powerBox.y)).toBeLessThan(3);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-header-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(name).toBeVisible();
  await expect(power.getByRole('button', { name: 'Restart', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-header-mobile.png', fullPage: true });
  await back.click();
  await expect(page).not.toHaveURL(/servers\/7/);
});

test('console height is independent, persisted, and moves charts beside a tall console', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1400 });
  await page.addInitScript(() => localStorage.setItem('gp_console_height', '900'));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  const panel = page.locator('.gp-console-panel');
  expect((await panel.boundingBox())!.height).toBeGreaterThan(490);
  expect(Math.abs((await panel.boundingBox())!.height - (await page.locator('.gp-server-stats').boundingBox())!.height)).toBeLessThan(2);
  const handle = page.getByRole('separator', { name: 'Resize console' });
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 450, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.gp-server-overview')).toHaveClass(/gp-server-overview-tall/);
  const charts = page.locator('.gp-server-charts');
  expect((await charts.boundingBox())!.x).toBeGreaterThan((await panel.boundingBox())!.x + 500);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-console-tall.png', fullPage: true });
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
      await expect(tooltip).toContainText(index === 0 ? 'CPU · vCPU' : 'Inbound');
      await expect(tooltip).toContainText(index === 0 ? 'vCPU' : 'B/s');
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
    if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: `test-results/server-metrics-${theme}.png`, fullPage: true });
  });
}

for (const tab of ['scheduledtasks', 'backup', 'containerconfig']) {
  for (const width of [1920, 390]) {
    test(`${tab} fills the page content at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/test/server-page.fixture.html#/nodes/local/servers/7/${tab}`);
      const body = page.locator('.gp-server-page-content .gp-server-settings-body');
      await expect(body).toBeVisible();
      if (width <= 1000) expect(
        await body.evaluate((element) => {
          let current = element.parentElement;
          while (current?.closest('.gp-server-page-content')) {
            if (
              current.scrollHeight > current.clientHeight + 1 &&
              /auto|scroll/.test(getComputedStyle(current).overflowY)
            )
              return true;
            current = current.parentElement;
          }
          return false;
        })
      ).toBe(false);
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
      if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({
        path: `test-results/server-page-${tab}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

test('restart confirmation follows the settings pane with the console open', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/containerconfig');
  await page.getByRole('button', { name: 'Open side console' }).click();
  await page.getByPlaceholder('e.g. 2', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save changes' });
  await expect(dialog).toBeVisible();
  const pane = await page.locator('.gp-server-workspace-main').boundingBox();
  const box = await dialog.boundingBox();
  expect(Math.abs(box!.x + box!.width / 2 - pane!.x - pane!.width / 2)).toBeLessThan(2);
  expect(box!.x + box!.width).toBeLessThan(pane!.x + pane!.width);
  expect(await dialog.evaluate(el => el.contains(document.elementFromPoint(el.getBoundingClientRect().right - 10, el.getBoundingClientRect().top + 10)))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => { const mobile = await dialog.boundingBox(); return mobile!.x >= 0 && mobile!.x + mobile!.width <= 390; }).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('workspace and dock fill the viewport with matching bottom edges across tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByRole('button', { name: 'Open side console' }).click();
  for (const name of ['File Editor', 'Game Config', 'Backups', 'Schedules', 'Settings', 'Terminal', 'Activity']) {
    await page.locator('.gp-server-tabs').getByRole('link', { name, exact: true }).click();
    const main = page.locator('.gp-server-workspace-main > section');
    await expect(main).toBeVisible();
    await expect.poll(async () => {
      const box = await main.boundingBox();
      return Math.abs(box!.y + box!.height - 984);
    }).toBeLessThan(2);
    const dock = await page.locator('.gp-console-dock').boundingBox();
    expect(Math.abs(dock!.y + dock!.height - 984)).toBeLessThan(2);
  }
  await page.setViewportSize({ width: 1200, height: 780 });
  await expect.poll(async () => {
    const box = await page.locator('.gp-console-dock').boundingBox();
    return Math.abs(box!.y + box!.height - 764);
  }).toBeLessThan(2);
});

for (const remove of [false, true]) test(`ZIP upload waits for extraction and retention choice (delete=${remove})`, async ({ page }, testInfo) => {
  const extracted: any[] = [];
  await page.route('**/files/upload?**', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/files/extract', route => {
    extracted.push(route.request().postDataJSON());
    return route.fulfill({ json: { job: { id: 91, status: 'pending' } } });
  });
  await page.route('**/files/transfers/91', route => route.fulfill({ json: { job: { id: 91, status: 'completed', completedFiles: 2 } } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles({ name: 'maps.zip', mimeType: 'application/zip', buffer: Buffer.from('mock archive') });
  await expect(page.getByText('Upload options', { exact: true })).toBeVisible();
  expect(extracted).toHaveLength(0);
  const dialog = page.locator('.gp-archive-options');
  await expect(dialog).toHaveCSS('border-radius', '14px');
  await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toHaveCSS('font-size', '14px');
  await expect(dialog.getByRole('button', { name: 'Upload', exact: true })).toHaveCSS('padding', '7px 12px');
  await expect(dialog.locator('[data-part="close-trigger"]')).toHaveCSS('width', '30px');
  await page.getByRole('switch', { name: 'Extract ZIP after upload', exact: true }).click();
  await expect(page.getByLabel('Keep ZIP archive', { exact: true })).toBeChecked();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await dialog.screenshot({ path: testInfo.outputPath('archive-options.png') });
  if (remove) await page.getByLabel('Delete ZIP only after successful extraction').check();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect.poll(() => extracted.length).toBe(1);
  expect(extracted[0]).toMatchObject({ path: '/maps.zip', root: 'data', deleteArchive: remove, overwrite: false });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('gamepanel_admin_runtime', '1');
    sessionStorage.setItem('gamepanel_active_node', 'local');
    localStorage.setItem('theme', 'dark');
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/servers/7') return route.fulfill({ json: { server: { uptimeSeconds: 101340 } } });
    if (url.pathname.endsWith('/files/roots'))
      return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (url.pathname.endsWith('/file'))
      return route.fulfill({ headers: { etag: '"fixture-version"' }, json: { content: 'hostname test', version: '"fixture-version"' } });
    if (url.pathname.endsWith('/files'))
      return route.fulfill({ json: { entries: [{ name: 'server.cfg', type: 'file' }] } });
    return route.fulfill({ json: { nodes: [], entries: [], settings: {} } });
  });
});

test('file view switches to tiles, retains selection and persists after reload', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByRole('checkbox', { name: 'Select server.cfg' }).click();
  await page.getByRole('button', { name: 'Switch to tile view' }).click();
  await expect(page.locator('[data-file-view="grid"]')).toHaveCSS('display', 'grid');
  await expect(page.getByRole('checkbox', { name: 'Select server.cfg' })).toBeChecked();
  await expect(page.locator('[data-file-name="server.cfg"] button[title="Download"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-file-view="grid"]')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to list view' }).click();
  await expect(page.locator('[data-file-view="list"]')).toBeVisible();
});

for (const name of ['picture.PNG', 'sound.mp3', 'unknown.bin']) test(`file preview handles ${name} without an editable document`, async ({ page }) => {
  await page.route('**/files?**', route => route.fulfill({ json: { entries: [{ name, type: 'file', size: 4000000 }] } }));
  await page.route('**/files/download-token', route => route.fulfill({ json: { path: '/preview-test' } }));
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  await page.route('**/preview-test', route => route.fulfill({ contentType: name.endsWith('mp3') ? 'audio/wav' : 'image/png', body: name.endsWith('mp3') ? wav : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText(name, { exact: true }).dblclick();
  const session = page.getByRole('region', { name: 'File editor session' });
  await expect(session.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(session.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  if (name.endsWith('PNG')) {
    await expect(session.getByRole('img', { name })).toBeVisible();
    await session.getByRole('button', { name: 'Original size' }).click();
    await expect(session.locator('.gp-image-canvas')).toHaveClass(/is-original/);
  } else if (name.endsWith('bin')) await expect(session.getByText('No preview available')).toBeVisible();
  else await expect(session.locator('audio')).toHaveAttribute('controls', '');
});

test('file roots selector is only shown when there is a choice', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await expect(page.locator('.gp-path-breadcrumb')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Data directory' })).toHaveCount(0);
  await page.route('**/files/roots', route => route.fulfill({ json: { roots: [
    { key: 'data', containerPath: '/data' }, { key: 'config', containerPath: '/config' },
  ] } }));
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Data directory' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Data directory' }).click();
  await page.getByRole('option', { name: '/config', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Data directory' })).toContainText('/config');
});
test('Manage opens a real server page; tabs, refresh and browser back retain context', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/fleet', route => route.fulfill({ json: { servers: [] } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  await expect(page).toHaveURL(/servers\/7\/console$/);
  await expect(page.getByRole('heading', { name: 'CS16 Test', exact: true })).toBeVisible();
  await expect(page.getByText('Server ready for players')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Game Config', exact: true }).click();
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ports', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to servers' }).click();
  await expect(page.getByRole('heading', { name: 'Game Servers', exact: true })).toBeVisible();
  await expect(page.getByText('Node administration', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('console and power are permission gated including direct URLs', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html?restricted#/nodes/local/servers/7/console');
  await expect(page.getByText("You don't have permission to read the console.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'File Editor', exact: true })).toHaveCount(0);
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
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-page-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'CS16 Test', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'File Editor', exact: true }).click();
  await expect(page.getByText('server.cfg', { exact: true })).toBeVisible();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-page-mobile-files.png', fullPage: true });
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
  await expect(page.getByRole('heading', { name: 'Loading server…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Server unavailable' })).toHaveCount(0);
  await expect(page.locator('.gp-server-skeleton')).toBeVisible();
  await expect(page.locator('.gp-server-state')).toHaveAttribute('aria-busy', 'true');
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-loading-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.locator('.gp-server-skeleton').evaluate((el) => getComputedStyle(el).animationName)
  ).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-loading-mobile.png', fullPage: true });
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
  await page.getByRole('link', { name: 'File Editor', exact: true }).click();
  await page.getByText('server.cfg', { exact: true }).dblclick();
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('hostname edited');
  await page.getByRole('link', { name: 'Console', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/filemanager$/);
  await expect(editor).toContainText('hostname edited');
  await page.goBack();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/filemanager$/);
  await expect(editor).toContainText('hostname edited');
  await page.getByRole('link', { name: 'Console', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByText('Server ready for players')).toBeVisible();
});

test('light theme keeps the configuration page readable and scrollable', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/gameconfig');
  await expect(page.getByText('Server configuration', { exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/server-page-light-config.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('editor tabs keep drafts, save the selected path and confirm closing dirty files', async ({ page }) => {
  const writes: any[] = [];
  await page.route('**/api/servers/7/files?**', route => route.fulfill({ json: { entries: [
    { name: 'server.cfg', type: 'file' }, { name: 'other.cfg', type: 'file' },
  ] } }));
  await page.route('**/api/servers/7/file?**', route => {
    if (route.request().method() !== 'GET') writes.push({ ...route.request().postDataJSON(), path: new URL(route.request().url()).searchParams.get('path') });
    return route.fulfill({ headers: { etag: '"fixture-version"' }, json: { content: 'hostname test', version: '"fixture-version"' } });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
  await page.getByRole('link', { name: 'File Editor', exact: true }).click();
  await page.getByText('server.cfg', { exact: true }).dblclick();
  const visibleEditor = page.locator('.monaco-editor:visible');
  await visibleEditor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('hostname draft');
  await page.getByRole('button', { name: 'Browse files' }).click();
  const browserTabsHeight = (await page.getByRole('tablist', { name: 'Open files' }).boundingBox())!.height;
  await page.getByText('other.cfg', { exact: true }).dblclick();
  expect((await page.getByRole('tablist', { name: 'Open files' }).boundingBox())!.height).toBe(browserTabsHeight);
  expect((await page.locator('.gp-editor-toolbar:visible').boundingBox())!.height).toBe(52);
  expect((await page.getByRole('button', { name: 'Save', exact: true }).boundingBox())!.height).toBe(30);
  await expect(page.getByRole('tab', { name: 'other.cfg' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'server.cfg' }).click();
  await expect(visibleEditor).toContainText('hostname draft');
  await page.getByRole('button', { name: 'Close server.cfg', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'server.cfg' })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ content: 'hostname draft', path: '/server.cfg' });
  await visibleEditor.click();
  await page.keyboard.press('ControlOrMeta+f');
  await page.locator('.find-widget .codicon-case-sensitive:visible').hover();
  const hover = page.locator('.monaco-hover:visible').last();
  await expect(hover).toBeVisible();
  const unobscured = await hover.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
  expect(unobscured).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/editor-session-dark-hover.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(visibleEditor).toHaveClass(/vs/);
  await expect(page.getByRole('tab', { name: 'server.cfg' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/editor-session-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/editor-session-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Close server.cfg', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'server.cfg' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'other.cfg' })).toHaveAttribute('aria-selected', 'true');
});

test('direct file page opens an editor and failed reads cannot be saved', async ({ page }) => {
  await page.route('**/api/servers/7/file?**', route => route.fulfill({ status: 500, json: { error: 'Read failed' } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('server.cfg', { exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Retry loading file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.route('**/api/servers/7/file?**', route => route.fulfill({ body: 'hostname recovered' }));
  await page.getByRole('button', { name: 'Retry loading file' }).click();
  await expect(page.locator('.monaco-editor:visible')).toContainText('hostname recovered');
});

test('side console shrinks the workspace without remounting dirty editor and closes cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('server.cfg', { exact: true }).dblclick();
  const editor = page.locator('.monaco-editor:visible');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('hostname unsaved-side-console');
  const original = (await editor.boundingBox())!.width;
  await page.getByRole('button', { name: 'Open side console' }).click();
  const dock = page.getByRole('complementary', { name: 'Side server console' });
  await expect(dock).toBeVisible();
  await expect(dock).toHaveCSS('opacity', '1');
  await expect(dock.getByRole('switch', { name: 'Toggle timestamps' })).toBeVisible();
  await expect(editor).toContainText('unsaved-side-console');
  expect((await editor.boundingBox())!.width).toBeLessThan(original - 300);
  expect((await editor.boundingBox())!.x + (await editor.boundingBox())!.width).toBeLessThan((await dock.boundingBox())!.x);
  await expect(dock.locator('.gp-console-panel')).toHaveCount(1);
  await expect(dock).toContainText('Server ready for players');
  let sent: any;
  await page.route('**/api/servers/7/console/commands', route => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true } });
  });
  await dock.getByPlaceholder('Type a command and press Enter…').fill('status');
  await dock.getByPlaceholder('Type a command and press Enter…').press('Enter');
  await expect.poll(() => sent).toEqual({ command: 'status' });
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/side-console-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/side-console-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(editor).toContainText('unsaved-side-console');
  await page.getByRole('button', { name: 'Close side console' }).click();
  await expect(dock).toHaveCount(0);
  await expect(editor).toContainText('unsaved-side-console');
  await expect(page.getByRole('button', { name: 'Open side console' })).toBeFocused();
});

test('side console is unavailable without log permissions', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html?restricted#/nodes/local/servers/7/containerconfig');
  await expect(page.getByRole('button', { name: 'Open side console' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Side server console' })).toHaveCount(0);
});

test('side console divider resizes both panes and remembers its width', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/containerconfig');
  await page.getByRole('button', { name: 'Open side console' }).click();
  await expect(page.getByText('Live console', { exact: true })).toHaveCount(0);
  const splitter = page.getByRole('separator', { name: 'Resize side console' });
  const dock = page.getByRole('complementary', { name: 'Side server console' });
  const width = (await dock.boundingBox())!.width;
  const handle = (await splitter.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 150);
  await page.mouse.down();
  await page.mouse.move(handle.x - 130, handle.y + 150, { steps: 12 });
  await page.mouse.up();
  expect((await dock.boundingBox())!.width).toBeGreaterThan(width + 100);
  const persisted = await splitter.getAttribute('aria-valuenow');
  await page.reload();
  await page.getByRole('button', { name: 'Open side console' }).click();
  await expect(splitter).toHaveAttribute('aria-valuenow', persisted!);
  await splitter.focus();
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '25');
  await splitter.press('End');
  await expect(splitter).toHaveAttribute('aria-valuenow', '60');
  await splitter.dblclick();
  await expect(splitter).toHaveAttribute('aria-valuenow', '38');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/side-console-resizable.png', fullPage: true });
});

test('opening either console starts at latest logs and commands opt out of credential autofill', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html?longLogs#/nodes/local/servers/7/console');
  const output = page.locator('.gp-console-terminal:visible');
  const remaining = () => output.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(remaining).toBeLessThan(2);
  await page.getByRole('link', { name: 'File Editor', exact: true }).click();
  await page.getByRole('button', { name: 'Open side console' }).click();
  await expect.poll(remaining).toBeLessThan(2);
  const command = page.getByRole('textbox', { name: 'Server console command' });
  await expect(command).toHaveJSProperty('tagName', 'TEXTAREA');
  await command.fill('status\nversion');
  await expect(command).toHaveValue('status version');
  await expect(command).toHaveAttribute('autocomplete', 'off');
  await expect(command).toHaveAttribute('data-1p-ignore', 'true');
  await output.hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(remaining).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: 'Scroll to latest logs' })).toBeVisible();
  await page.getByRole('button', { name: 'Close side console' }).click();
  await page.getByRole('button', { name: 'Open side console' }).click();
  await expect.poll(remaining).toBeLessThan(2);
});

test('editor saves directly and preserves edits after a failed write', async ({ page }) => {
  const writes: any[] = [];
  await page.route('**/api/servers/7/file?**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ headers: { etag: '"v1"' }, body: 'hostname original' });
    const body = route.request().postDataJSON(); writes.push(body);
    if (writes.length === 1) return route.fulfill({ status: 503, json: { error: 'Storage unavailable' } });
    if (!body.overwrite) return route.fulfill({ status: 409, json: { error: 'File changed since it was opened' } });
    return route.fulfill({ json: { ok: true, version: '"v3"' } });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('server.cfg', { exact: true }).dblclick();
  const editor = page.locator('.monaco-editor:visible');
  await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('hostname draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.gp-editor-error')).toContainText('Storage unavailable');
  await expect(editor).toContainText('hostname draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(writes[1]).toEqual({ content: 'hostname draft', version: '"v1"', overwrite: true });
  await expect(page.getByText('Compare: current server file')).toHaveCount(0);
});

test('explicit editor overwrite does not require a cached file version', async ({ page }) => {
  let written: any;
  await page.route('**/api/servers/7/file?**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ body: 'hostname original' });
    written = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, version: '"v2"' } });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('server.cfg', { exact: true }).dblclick();
  await page.locator('.monaco-editor:visible').click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('hostname draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(written).toEqual({ content: 'hostname draft', overwrite: true });
});

test('Native backup operations and legacy archives remain inspectable after reload', async ({ page }) => {
  await page.route('**/backups/jobs', route => route.fulfill({json:{jobs:[{id:'job-1',kind:'backup',status:'running',startedAt:'2026-09-20T12:00:00Z'}]}}));
  await page.route('**/backups/compatibility', route => route.fulfill({json:{native:true,capabilities:{backupJobs:1,nativeRestoreRecovery:1},layoutReady:true,recoveryCount:1,legacy:[{name:'legacy.tar.gz',size:100,modifiedAt:'2026-09-19T00:00:00Z'}]}}));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await expect(page.getByRole('region',{name:'Backup operations'})).toContainText('running');
  await expect(page.getByRole('button',{name:'Create backup now'})).toBeDisabled();
  await page.getByText('Legacy archives (1)', { exact: true }).click();
  await expect(page.getByText('legacy.tar.gz', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region',{name:'Backup operations'})).toContainText('running');
});

test('an agent without backup job support leaves the backup page usable with an explicit error', async ({page})=>{
  await page.route('**/backups/jobs', route=>route.fulfill({json:{}}));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await expect(page.getByRole('heading',{name:'Backups',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Unable to refresh operation status');
});

test('Native backup confirmation validates a custom name and waits for its background result',async({page})=>{
  let submitted:any=null;
  await page.route('**/backups/jobs',route=>route.fulfill({json:{jobs:submitted?[{id:'named-job',kind:'backup',status:'completed',startedAt:new Date().toISOString(),result:{ok:true,exitCode:0}}]:[]}}));
  await page.route('**/backups/compatibility',route=>route.fulfill({json:{native:true,capabilities:{backupJobs:1,nativeRestoreRecovery:1},layoutReady:true,legacy:[],recoveryCount:0}}));
  await page.route('**/backups/create',route=>{submitted=route.request().postDataJSON();return route.fulfill({status:202,json:{job:{id:'named-job',status:'running'}}});});
  await page.route('**/backups/jobs/named-job',route=>route.fulfill({json:{job:{id:'named-job',kind:'backup',status:'completed',result:{ok:true,exitCode:0}}}}));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await page.getByRole('button',{name:'Create backup now'}).click();
  const dialog=page.getByRole('dialog',{name:'Create backup'});
  await dialog.getByLabel('Backup name (optional)').fill('../invalid');
  await expect(dialog.getByRole('button',{name:'Create backup',exact:true})).toBeDisabled();
  await dialog.getByLabel('Backup name (optional)').fill('Before update');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(submitted).toBeNull();
  await page.getByRole('button',{name:'Create backup now'}).click();
  await expect(dialog.getByLabel('Backup name (optional)')).toHaveValue('');
  await dialog.getByLabel('Backup name (optional)').fill('Before update');
  await dialog.getByRole('button',{name:'Create backup',exact:true}).click();
  await expect.poll(()=>submitted).toEqual({name:'Before update'});
  await expect(page.getByRole('button',{name:'Create backup now'})).toBeEnabled();
});


test('Native backup mutation is disabled when runtime recovery capabilities are missing', async ({ page }) => {
  await page.route('**/backups/jobs', route => route.fulfill({ json: { jobs: [] } }));
  let current = false;
  await page.route('**/backups/compatibility', route => route.fulfill({ json: {
    native: true, layoutReady: true, legacy: [], recoveryCount: 0,
    ...(current ? { capabilities: { backupJobs: 1, nativeRestoreRecovery: 1 } } : {}),
  } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  await expect(page.getByText('Update this node’s agent to enable persistent backup jobs and safe restore recovery.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create backup now' })).toBeDisabled();
  current = true;
  await page.getByRole('button', { name: 'Recheck runtime' }).click();
  await expect(page.getByRole('button', { name: 'Create backup now' })).toBeEnabled();
});

test('file operation history survives reload without repeating a mutation', async ({ page }) => {
  let mutations = 0;
  await page.route('**/files/transfers?*', route => {
    if (route.request().method() !== 'GET') mutations++;
    return route.fulfill({ json: { jobs: [{ id: 81, kind: 'extract', status: 'completed', basePath: '/', transferredBytes: 1024, completedFiles: 3, errorMessage: null }] } });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('File operation history', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'File operations' })).toContainText('file-81');
  await page.reload();
  await page.getByText('File operation history', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'File operations' })).toContainText('3 files');
  expect(mutations).toBe(0);
});

for (const status of ['running', 'stopped', 'unknown']) {
  test(`Native restore requires a stopped server: ${status}`, async ({ page }) => {
    await page.route('**/backups', route => route.fulfill({ json: { path: '/', entries: [{ name: 'manual.tar.gz', size: 512, modifiedAt: new Date().toISOString() }] } }));
    await page.route('**/backups/jobs', route => route.fulfill({ json: { jobs: [] } }));
    await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, capabilities: { backupJobs: 1, nativeRestoreRecovery: 1 }, layoutReady: true, legacy: [], recoveryCount: 0 } }));
    await page.goto(`/test/server-page.fixture.html?status=${status}#/nodes/local/servers/7/backup`);
    await expect(page.getByRole('button', { name: 'Create backup now' })).toBeEnabled();
    const restore = page.getByRole('button', { name: 'Restore', exact: true });
    if (status === 'stopped') await expect(restore).toBeEnabled();
    else {
      await expect(restore).toBeDisabled();
      await expect(restore).toHaveAttribute('title', 'Stop the server before restoring a Native backup.');
      await expect(page.getByText('Restore: Stop the server before restoring a Native backup.')).toBeVisible();
    }
  });
}
for (const theme of ['light', 'dark']) {
  test(`server header is compact and power controls retain their state in ${theme}`, async ({ page }) => {
    await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    await expect(page.getByRole('region', { name: 'Server context', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveAttribute('title', 'Start requires a confirmed stopped server.');
    await page.getByRole('link', { name: 'File Editor', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('Native backup cannot start while operation status is unavailable and recovers after recheck', async ({ page }) => {
  let available = false;
  await page.route('**/backups/jobs', route => route.fulfill(available ? { json: { jobs: [] } } : { status: 503, json: { error: 'Unavailable' } }));
  await page.route('**/backups/compatibility', route => route.fulfill({ json: { native: true, capabilities: { backupJobs: 1, nativeRestoreRecovery: 1 }, layoutReady: true, legacy: [], recoveryCount: 0 } }));
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/backup');
  const create = page.getByRole('button', { name: 'Create backup now' });
  await expect(create).toBeDisabled();
  await expect(page.getByText('Wait for a confirmed operation status before starting another action.', { exact: true })).toBeVisible();
  available = true;
  await page.getByRole('button', { name: 'Recheck runtime' }).click();
  await expect(create).toBeEnabled();
});

for (const theme of ['light', 'dark']) {
  test(`power confirmation can be cancelled with keyboard on mobile in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/console');
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    const restart = page.getByRole('button', { name: 'Restart', exact: true });
    await restart.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.focus(); await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(restart).toBeFocused();
    expect(await page.evaluate(() => ((window as any).actions || []).filter((action: any) => action.action === 'restart'))).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}


test('a full rolling console buffer counts new logs and keeps following the tail', async ({ page }) => {
  await page.goto('/test/server-page.fixture.html?performance#/nodes/local/servers/7/console');
  const output = page.locator('.gp-console-terminal:visible');
  const append = (count: number) => page.evaluate(count => window.dispatchEvent(new CustomEvent('gp-performance-logs', { detail: count })), count);
  const remaining = () => output.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
  await append(5000);
  await expect(output.locator('pre')).toHaveCount(5000);
  await expect.poll(remaining).toBeLessThan(2);
  await output.hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(remaining).toBeGreaterThan(100);
  await append(100);
  const jump = page.getByRole('button', { name: 'Scroll to latest logs' });
  await expect(jump).toHaveText('100 new logs');
  await expect(output.locator('pre')).toHaveCount(5000);
  await jump.click();
  await expect.poll(remaining).toBeLessThan(2);
  await append(100);
  await expect(output.locator('pre').last()).toContainText('Performance log 5200:');
  await expect.poll(remaining).toBeLessThan(2);
  await expect(jump).not.toBeVisible();
});
