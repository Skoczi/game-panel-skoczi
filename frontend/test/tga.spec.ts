import { test, expect } from '@playwright/test';
import { decodeTga } from '../components/serverSettings/tgaDecoder';

function tga(type = 2, depth = 24, descriptor = 32, width = 2, height = 1, pixels = [0, 0, 255, 0, 255, 0]) {
  const data = new Uint8Array(18 + pixels.length);
  data[2] = type; data[12] = width & 255; data[13] = width >> 8;
  data[14] = height & 255; data[15] = height >> 8;
  data[16] = depth; data[17] = descriptor; data.set(pixels, 18);
  return data.buffer;
}
test('TGA decodes BGR and both horizontal orientations', () => {
  expect([...decodeTga(tga()).data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  expect([...decodeTga(tga(2, 24, 48)).data]).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
  expect([...decodeTga(tga(2, 24, 0, 1, 2)).data]).toEqual([0, 255, 0, 255, 255, 0, 0, 255]);
});
test('TGA supports RLE, alpha and grayscale', () => {
  expect([...decodeTga(tga(10, 32, 40, 2, 1, [129, 0, 0, 255, 128])).data]).toEqual([255, 0, 0, 128, 255, 0, 0, 128]);
  expect([...decodeTga(tga(11, 8, 32, 2, 1, [1, 10, 20])).data]).toEqual([10, 10, 10, 255, 20, 20, 20, 255]);
});
test('TGA rejects excessive dimensions, truncated data and overflowing runs', () => {
  expect(() => decodeTga(tga(2, 24, 32, 8192, 8192))).toThrow(/16 megapixels/);
  expect(() => decodeTga(tga(2, 24, 32, 2, 1, [0]))).toThrow(/Truncated/);
  expect(() => decodeTga(tga(10, 24, 32, 2, 1, [130, 0, 0, 0]))).toThrow(/run length/);
  expect(() => decodeTga(new ArrayBuffer(4))).toThrow(/size/);
});
test('TGA preview is lazy, displayed and can be closed', async ({ page }) => {
  await page.addInitScript(() => { sessionStorage.setItem('gamepanel_admin_runtime', '1'); sessionStorage.setItem('gamepanel_active_node', 'local'); });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.endsWith('/files/roots')) return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (path.endsWith('/files')) return route.fulfill({ json: { entries: [{ name: 'arctic.TGA', type: 'file' }] } });
    if (path.endsWith('/download-token')) return route.fulfill({ json: { path: '/tga-test' } });
    return route.fulfill({ json: { nodes: [], entries: [], settings: {} } });
  });
  await page.route('**/tga-test', route => route.fulfill({ body: Buffer.from(tga()) }));
  let workers = 0; page.on('worker', () => workers++);
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  expect(workers).toBe(0);
  await page.getByText('arctic.TGA', { exact: true }).dblclick();
  const image = page.getByRole('img', { name: 'arctic.TGA' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  expect(workers).toBe(1);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close arctic.TGA' }).click();
  await expect(image).toHaveCount(0);
});
