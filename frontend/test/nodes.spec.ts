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
