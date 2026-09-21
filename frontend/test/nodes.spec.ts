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
test('local identity saves metadata, survives reload and reports real response health', async ({
  page,
}) => {
  let local = {
    id: 'local',
    name: 'Local',
    location: '',
    origin: '',
    status: 'online',
    agent_version: '1.5.0-skoczi.16',
    last_seen: Date.now(),
    heartbeat_kind: 'panel-response',
  };
  await page.route('**/api/nodes', (r) => r.fulfill({ json: { nodes: [node], local } }));
  await page.route('**/api/nodes/local/profile', (r) => {
    expect(r.request().method()).toBe('PUT');
    local = { ...local, ...r.request().postDataJSON() };
    return r.fulfill({ json: { local } });
  });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Node settings', exact: true }).first().click();
  await page.getByLabel('Name', { exact: true }).fill('WAW2');
  await page.getByLabel('Location', { exact: true }).fill('Warsaw, PL');
  await page.getByLabel('Origin', { exact: true }).fill('https://eserv.pl');
  await page.getByRole('button', { name: 'Save local node' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local node saved.' })).toHaveText('Local node saved.');
  await expect(page.getByRole('heading', { name: 'WAW2', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'WAW2', exact: true })).toBeVisible();
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: /^WAW2/ })).toBeVisible();
  await page.getByRole('combobox').press('Escape');
  await expect(page.getByText('https://eserv.pl', { exact: true })).toBeVisible();
  await page.route('**/api/nodes', (r) =>
    r.fulfill({ status: 503, json: { error: 'Unavailable' } })
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Status unavailable', { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('Local and remote node settings open distinct allocation endpoints and protect unsaved edits', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route('**/api/nodes/*/allocations', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      json: {
        revision: 1,
        network: { restrictPorts: true, allocations: [] },
        assignments: [],
        pending: false,
      },
    });
  });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Node settings', exact: true }).first().click();
  await expect(page.getByText('No additional agent required', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'IP allocations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Local · Allocations' })).toBeVisible();
  await page.getByLabel('Restrict published ports').uncheck();
  await page.getByRole('button', { name: '← Nodes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: '← Nodes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Node settings', exact: true }).last().click();
  await page.getByRole('button', { name: 'IP allocations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Warsaw test · Allocations' })).toBeVisible();
  await expect(page.getByLabel('Show Follow Us')).toHaveCount(0);
  expect(requested.some((url) => url.endsWith('/local/allocations'))).toBe(true);
  expect(requested.some((url) => url.endsWith(`/${id}/allocations`))).toBe(true);
  await page.addStyleTag({ content: 'html { color-scheme: dark; }' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/node-allocations-dark-mobile.png', fullPage: true });
});
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
  await page.addInitScript((value) => {
    sessionStorage.setItem('gamepanel_active_node', value);
    sessionStorage.setItem('gamepanel_admin_runtime', '1');
  }, id);
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
  await expect(page.getByRole('button', { name: 'Open servers', exact: true })).toBeEnabled();
});
test('Local opens the administrator runtime even when Local is already the default', async ({
  page,
}) => {
  await page.goto('/test/nodes.fixture.html');
  const button = page.getByRole('button', { name: 'Open local servers' });
  await expect(button).toBeEnabled();
  await Promise.all([page.waitForEvent('load'), button.click()]);
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_admin_runtime'))).toBe('1');
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_active_node'))).toBe('local');
  // Reopening the same runtime must navigate too, not silently do nothing.
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Open local servers' }).click(),
  ]);
});

test('pending node deletion needs the exact name, clears enrollment, and removes the card', async ({
  page,
}) => {
  let deleted = false;
  await page.route('**/api/nodes', (r) =>
    r.fulfill({
      json:
        r.request().method() === 'GET'
          ? { nodes: deleted ? [] : [{ ...node, status: 'pending', agent_version: null }] }
          : { node, enrollmentToken: 'x'.repeat(43) },
    })
  );
  await page.route(`**/api/nodes/${id}`, (r) => {
    expect(r.request().method()).toBe('DELETE');
    expect(r.request().postDataJSON()).toEqual({ confirmationName: node.name });
    deleted = true;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Delete node', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Confirm deletion' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the node name to confirm').fill('Wrong');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the node name to confirm').fill(node.name);
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: node.name })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open local servers' })).toBeEnabled();
});

test('deletion error stays inside the dialog and keeps the node', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/nodes', (r) =>
    r.fulfill({ json: { nodes: [{ ...node, status: 'disabled', enabled: 0 }] } })
  );
  await page.route(`**/api/nodes/${id}`, (r) =>
    r.fulfill({ status: 409, json: { error: 'This node has tracked servers.' } })
  );
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Delete node', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type the node name to confirm').fill(node.name);
  await dialog.getByRole('button', { name: 'Confirm deletion' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This node has tracked servers.');
  expect(await dialog.evaluate((el) => el.getBoundingClientRect().width <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/node-delete-dark-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: node.name })).toBeVisible();
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
  await expect(
    page.getByRole('button', { name: 'Node settings', exact: true }).last()
  ).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/nodes-mobile.png', fullPage: true });
});
test('desktop dark theme keeps node controls readable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/test/nodes.fixture.html');
  await expect(page.getByRole('heading', { name: 'Warsaw test' })).toBeVisible();
  await expect(page.locator('#active-node')).toHaveCSS('color', 'rgb(255, 255, 255)');
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/nodes-desktop-dark.png', fullPage: true });
});

test('custom node menu supports keyboard, view selection and outside dismissal', async ({
  page,
}) => {
  await page.goto('/test/nodes.fixture.html');
  const trigger = page.getByRole('combobox');
  await expect(trigger).toHaveAccessibleName('Node scope All nodes');
  await trigger.click();
  await expect(page.getByRole('option', { name: /Warsaw test/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /^All nodes/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await trigger.press('End');
  const option = page.getByRole('option', { name: /Warsaw test/ });
  await expect(trigger).toHaveAttribute(
    'aria-activedescendant',
    (await option.getAttribute('id'))!
  );
  await trigger.press('Enter');
  await expect(trigger).toContainText('Warsaw test');
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

test('custom node menu selects view scope without changing runtime and stays within mobile viewport', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: /Warsaw test/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/node-selector-mobile.png', fullPage: true });
  await page.getByRole('option', { name: /Warsaw test/ }).click();
  await expect(page.getByRole('combobox')).toContainText('Warsaw test');
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_node_scope_2'))).toBe(id);
  expect(await page.evaluate(() => sessionStorage.getItem('gamepanel_active_node'))).toBeNull();
});

test('custom node menu shows unavailable selection without silently switching to Local', async ({
  page,
}) => {
  await page.addInitScript((value) => {
    sessionStorage.setItem('gamepanel_node_scope_2', value);
    sessionStorage.setItem('gamepanel_admin_runtime', '1');
  }, id);
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
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/node-selector-dark.png', fullPage: true });
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
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option', { name: /^All nodes/ }).click();
  await expect(page.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  expect(dialogs).toBe(0);
});

test('narrow node list has no host icons and keeps location separate from status', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/nodes', (r) =>
    r.fulfill({
      json: {
        nodes: [
          { ...node, name: 'Example A', location: 'London, UK', status: 'pending' },
          {
            ...node,
            id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
            name: 'Example B',
            location: 'Amsterdam, NL',
            status: 'pending',
          },
          {
            ...node,
            id: 'cccccccc-cccc-4ccc-bccc-cccccccccccc',
            name: 'Example C',
            location: 'Frankfurt, DE',
            status: 'pending',
          },
        ],
      },
    })
  );
  await page.goto('/test/nodes.fixture.html');
  await page.locator('.gp-node-selector').evaluate((element) => {
    element.style.width = '220px';
  });
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option')).toHaveCount(5);
  await expect(page.locator('[role="option"] .lucide-server')).toHaveCount(0);
  await expect(page.locator('.gp-node-trigger .lucide-server')).toHaveCount(1);
  for (const row of await page.getByRole('option').all()) {
    const location = await row.locator('.gp-node-location').boundingBox();
    const status = await row.locator('.gp-node-caption').boundingBox();
    expect(location!.y + location!.height).toBeLessThanOrEqual(status!.y);
    expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page
    .locator('.gp-node-selector')
    .screenshot({ path: 'test-results/node-selector-compact-trigger.png' });
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/node-selector-compact.png', fullPage: true });
});

test('node compatibility distinguishes unavailable runtime from unsupported capabilities', async ({ page }) => {
  await page.route('**/api/nodes', route => route.fulfill({ json: { nodes: [node] } }));
  let available = false;
  await page.route('**/api/health', route => available
    ? route.fulfill({ json: { status: 'healthy', version: '2.0.49', capabilities: { versionedFiles: 1, backupJobs: 1, nativeRestoreRecovery: 1, absoluteResources: 1 } } })
    : route.fulfill({ status: 502, json: { error: 'Agent unreachable' } }));
  await page.goto('/test/nodes.fixture.html');
  await page.getByRole('button', { name: 'Node settings', exact: true }).last().click();
  const section = page.getByRole('region', { name: 'Runtime compatibility' });
  await expect(section).toContainText('Game state is unknown');
  available = true;
  await section.getByRole('button', { name: 'Check compatibility' }).click();
  await expect(section).toContainText('2.0.49');
  await expect(section).toContainText('Native restore recovery: Supported');
  await expect(section.getByText('Not recorded', { exact: true })).toHaveCount(2);
});
