import { test, expect } from '@playwright/test';

test('JSON diagnostics run in a local worker', async ({ page }) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto('/test/editor.fixture.html');
  await page.getByRole('button', { name: 'Other file' }).click();
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('{"port": }');
  await expect(page.locator('.squiggly-error').first()).toBeVisible();
  expect(workers.some(url => url.includes('json.worker'))).toBe(true);
  expect(workers.every(url => url.startsWith('http://127.0.0.1:4178/'))).toBe(true);
});

test('Monaco edits, undoes, saves and preserves find state across theme changes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/test/editor.fixture.html');
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('test_value 1');
  await expect(page.getByTestId('value')).toContainText('test_value 1');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('value')).not.toContainText('test_value 1');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('saves')).toHaveText('1');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.locator('.find-widget.visible')).toBeVisible();
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await expect(page.locator('.monaco-editor.vs-dark')).toBeVisible();
  await expect(page.locator('.find-widget.visible')).toBeVisible();
  await page.screenshot({ path: 'test-results/monaco-dark.png' });
  expect(errors).toEqual([]);
});

test('Monaco respects read-only, isolates files and disposes models', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/test/editor.fixture.html');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Read only' }).click();
  await page.locator('.monaco-editor').click();
  await page.keyboard.type('DO NOT WRITE');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('value')).not.toContainText('DO NOT WRITE');
  await expect(page.getByTestId('saves')).toHaveText('0');
  await page.getByRole('button', { name: 'Other file' }).click();
  await expect(page.getByTestId('value')).toHaveText('{"port":27015}');
  await page.getByRole('button', { name: 'Read only' }).click();
  await page.locator('.monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('value')).toHaveText('{"port":27015}');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Toggle editor' }).click();
    await expect(page.locator('.monaco-editor')).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle editor' }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
  }
  expect(errors).toEqual([]);
});
