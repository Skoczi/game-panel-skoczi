import { test, expect } from '@playwright/test';

test('section failure preserves navigation and local retry does not reload the document', async ({ page }) => {
  await page.goto('/test/error-boundary.fixture.html');
  await expect(page.getByRole('alert')).toContainText('This section could not be displayed');
  await page.getByRole('button', { name: 'Nodes', exact: true }).click();
  await expect(page.getByText('Nodes ready')).toBeVisible();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Repair fixture' }).click();
  await page.getByRole('button', { name: 'Retry section' }).click();
  await expect(page.getByText('Files ready')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
