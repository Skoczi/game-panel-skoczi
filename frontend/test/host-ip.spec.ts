import { test, expect } from '@playwright/test';

test('restricted IPs show ranges, reject default selection and flag forbidden host ports', async ({ page }) => {
  await page.route('**/api/system/bind-addresses', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ addresses: ['192.0.2.10', '192.0.2.11'], requireExplicitIp: true,
      portsByIp: { '192.0.2.10': { tcp: [{ from: 27015, to: 27030 }], udp: [] }, '192.0.2.11': { tcp: [], udp: [{ from: 28015, to: 28020 }] } } }),
  }));
  await page.goto('/test/host-ip.fixture.html');
  const select = page.getByRole('combobox', { name: 'Host IPv4' }).first();
  await expect(select.locator('option[value=""]')).toHaveJSProperty('disabled', true);
  await expect(page.getByText('Select an IP for this port.')).toBeVisible();
  await select.selectOption('192.0.2.10');
  await expect(page.getByText('Allowed TCP: 27015–27030')).toBeVisible();
  await expect(page.getByText('Host port is outside the allowed ranges.')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Host port' }).fill('8080');
  await expect(page.getByText('Host port is outside the allowed ranges.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Host port' }).fill('27030');
  await expect(page.getByText('Host port is outside the allowed ranges.')).toHaveCount(0);
  await select.selectOption('192.0.2.11');
  await expect(page.getByText('Host port is outside the allowed ranges.')).toBeVisible();
});

test('operator IPs selectable and unavailable saved addresses never widened', async ({ page }) => {
  await page.route('**/api/system/bind-addresses', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ addresses: ['192.0.2.10', '192.0.2.11'] }),
  }));
  await page.goto('/test/host-ip.fixture.html');
  const selectors = page.getByRole('combobox', { name: 'Host IPv4' });
  await expect(selectors.first()).toBeEnabled();
  await selectors.first().selectOption('192.0.2.11');
  await expect(page.getByTestId('selected')).toHaveText('192.0.2.11');
  await expect(selectors.nth(1)).toHaveValue('192.0.2.99');
  await expect(selectors.nth(1).locator('option:checked')).toHaveText('192.0.2.99 — not configured');
});

test('failed address discovery disables selection without clearing the saved IP', async ({ page }) => {
  await page.route('**/api/system/bind-addresses', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.goto('/test/host-ip.fixture.html');
  await expect(page.getByRole('alert').first()).toBeVisible();
  const saved = page.getByRole('combobox', { name: 'Host IPv4' }).nth(1);
  await expect(saved).toBeDisabled();
  await expect(saved).toHaveValue('192.0.2.99');
});
