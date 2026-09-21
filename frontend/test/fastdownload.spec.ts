import { test, expect } from '@playwright/test';
test('FastDownload settings follow resources, save toggles and fit mobile', async ({ page }) => {
  let state = {
    supported: true,
    available: true,
    enabled: true,
    compression: true,
    busy: false,
    url: 'https://waw2.eserv.pl/fdl/srv56/cstrike/',
    directory: '/fastdownload/cstrike',
    lastSync: '2026-09-21T20:00:00Z',
    error: null,
    published: 42,
    folders: ['maps', 'models', 'sound'],
    canApplyConfig: true,
  };
  let sync = 0;
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.route('**/api/**', (r) => {
    const q = r.request(),
      url = new URL(q.url());
    if (!url.pathname.startsWith('/api/')) return r.continue();
    if (url.pathname.endsWith('/fastdownload/sync')) {
      sync++;
      return r.fulfill({ json: { queued: true } });
    }
    if (url.pathname.endsWith('/fastdownload')) {
      if (q.method() === 'PATCH') state = { ...state, ...q.postDataJSON() };
      return r.fulfill({ json: state });
    }
    if (url.pathname.endsWith('/available-ports')) return r.fulfill({ json: { ports: [] } });
    if (url.pathname.endsWith('/available-cpus'))
      return r.fulfill({
        json: { cpuBindingProtocol: 1, cores: [], assignments: [], availableCpuIds: [] },
      });
    return r.fulfill({
      json: {
        dockerImage: 'rehlds',
        providerMetadata: {},
        ports: { tcp: [], udp: [] },
        env: {},
        mounts: [{ key: 'data', containerPath: '/data' }],
        resourceLimits: { cpu: 1, memoryMb: 1024 },
      },
    });
  });
  await page.goto('/test/container-settings.fixture.html');
  const card = page.locator('.gp-fdl');
  await expect(card.getByText('FastDownload', { exact: true })).toBeVisible();
  const resources = page.getByRole('heading', { name: 'Resources & Volumes' });
  expect((await resources.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y);
  await card.getByRole('button', { name: 'Synchronize now', exact: true }).click();
  await expect.poll(() => sync).toBe(1);
  await card.getByRole('switch', { name: 'Enable FastDownload', exact: true }).click();
  await expect.poll(() => state.enabled).toBe(false);
  await expect(card.getByRole('button', { name: 'Synchronize now', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await card.screenshot({ path: 'test-results/fastdownload-mobile.png' });
});
