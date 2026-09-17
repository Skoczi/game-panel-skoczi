import { test, expect } from '@playwright/test';
const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const node = {
  id,
  name: 'Warsaw test',
  origin: 'https://node.example.com',
  location: 'Warsaw',
  status: 'online',
  enabled: 1,
  last_seen: Date.now(),
  agent_version: '1.5.0-skoczi.7',
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/system/appearance', (r) =>
    r.fulfill({ json: { appearance: { siteName: 'Example' } } })
  );
  await page.route('**/api/nodes', (r) =>
    r.fulfill({
      json:
        r.request().method() === 'GET'
          ? { nodes: [node] }
          : { node, enrollmentToken: 'x'.repeat(43) },
    })
  );
});
test('node enrollment keeps token masked and gives explicit operator instructions', async ({
  page,
}) => {
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Warsaw test');
  await page.getByRole('textbox', { name: 'Agent HTTPS origin' }).fill('https://node.example.com');
  await page.getByRole('button', { name: 'Create enrollment' }).click();
  await expect(page.getByLabel('Enrollment token')).toHaveAttribute('type', 'password');
  await expect(
    page.getByText('One-time token, valid for 15 minutes.', { exact: false })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss token' }).click();
  await expect(page.getByLabel('Enrollment token')).toHaveCount(0);
});
test('remote selection is per-tab and failed remote request cannot reach local server API', async ({
  page,
}) => {
  await page.addInitScript((value) => sessionStorage.setItem('gamepanel_active_node', value), id);
  let local = 0,
    remote = 0;
  await page.route('**/api/servers/1', (r) => {
    local++;
    return r.fulfill({ json: {} });
  });
  await page.route(`**/api/nodes/${id}/runtime/api/servers/1`, (r) => {
    remote++;
    return r.fulfill({ status: 503, json: { error: 'Node unavailable' } });
  });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Test selected runtime' }).click();
  await expect.poll(() => remote).toBe(1);
  expect(local).toBe(0);
  await expect(page.getByRole('button', { name: 'Open servers', exact: true })).toBeDisabled();
});
test('disabled node has no server or allocation action; mobile layout stays within viewport', async ({
  page,
}) => {
  await page.route('**/api/nodes', (r) =>
    r.fulfill({ json: { nodes: [{ ...node, status: 'disabled', enabled: 0 }] } })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/nodes.fixture.html');
  await expect(page.getByRole('button', { name: 'Open servers', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'IP allocations' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/nodes-mobile.png', fullPage: true });
});
test('desktop dark theme keeps node controls readable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/test/nodes.fixture.html');
  await expect(page.getByRole('heading', { name: 'Warsaw test' })).toBeVisible();
  await expect(page.locator('#active-node')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: 'test-results/nodes-desktop-dark.png', fullPage: true });
});

test('custom node menu supports keyboard, selection cancellation and outside dismissal', async ({
  page,
}) => {
  await page.goto('/test/nodes.fixture.html');
  const trigger = page.getByRole('combobox', { name: 'Execution node Local' });
  await trigger.click();
  await expect(page.getByRole('option', { name: /Warsaw test/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Local/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await trigger.press('End');
  const option = page.getByRole('option', { name: /Warsaw test/ });
  await expect(trigger).toHaveAttribute(
    'aria-activedescendant',
    (await option.getAttribute('id'))!
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_active_node'))).toBeNull();
  await trigger.click();
  await trigger.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await trigger.click();
  await page.getByRole('heading', { name: 'Warsaw test' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('custom node menu selects confirmed runtime and stays within mobile viewport', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: /Warsaw test/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/node-selector-mobile.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('option', { name: /Warsaw test/ }).click();
  await expect(page.getByRole('combobox')).toContainText('Warsaw test');
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_active_node'))).toBe(id);
});

test('custom node menu shows unavailable selection without silently switching to Local', async ({
  page,
}) => {
  await page.addInitScript((value) => sessionStorage.setItem('gamepanel_active_node', value), id);
  await page.route('**/api/nodes', (r) =>
    r.fulfill({ status: 503, json: { error: 'Unavailable' } })
  );
  await page.goto('/test/nodes.fixture.html');
  await expect(page.getByRole('combobox')).toContainText('Selected node');
  await expect(page.getByRole('combobox')).toContainText('Status unavailable');
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: /Selected node/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
});

test('custom node menu renders open dark theme', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: /Warsaw test/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/node-selector-dark.png', fullPage: true });
});

test('custom node menu handles Local-only inventory without prompting or navigation', async ({
  page,
}) => {
  await page.route('**/api/nodes', (r) => r.fulfill({ json: { nodes: [] } }));
  await page.goto('/test/nodes.fixture.html');
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('option').click();
  await expect(page.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  expect(dialogs).toBe(0);
});
