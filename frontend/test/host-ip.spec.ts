import { test, expect } from '@playwright/test';

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
