import { test, expect } from '@playwright/test';
const definition = {
  schemaVersion: 1,
  name: 'Counter-Strike 1.6',
  description: 'One UDP port for Game / Query / RCON.',
  author: 'Skoczi',
  source: 'LinuxGSM',
  runtime: {
    provider: 'linuxgsm',
    image: 'gameservermanagers/gameserver:cs',
    catalogId: 'cs',
    gameServerName: 'csserver',
    architectures: ['x64'],
  },
  ports: [
    {
      key: 'game',
      label: 'Game / Query / RCON',
      protocol: 'udp',
      container: 27015,
      suggested: 27015,
      env: '',
      linuxgsmKey: 'port',
    },
  ],
  variables: [],
  mounts: [{ key: 'data', containerPath: '/data' }],
};
const row = {
  id: 'builtin-cs16',
  version: 1,
  status: 'draft',
  document: definition,
  hash: 'a'.repeat(64),
  actor: 'bundled',
  created_at: '2026-01-01T00:00:00Z',
};
async function mock(page: import('@playwright/test').Page, status = 'draft') {
  await page.route('**/api/game-templates', (r) =>
    r.fulfill({ json: { templates: [{ ...row, status }] } })
  );
  await page.route('**/api/nodes', (r) =>
    r.fulfill({
      json: {
        nodes: [
          {
            id: 'test-node',
            name: 'Test node',
            location: 'Test location',
            status: 'online',
            enabled: 1,
          },
        ],
      },
    })
  );
  await page.route('**/allocations', (r) =>
    r.fulfill({
      json: {
        network: {
          allocations: [{ ip: '192.0.2.10', alias: 'Game IP', udp: '27015-27030', tcp: '' }],
        },
      },
    })
  );
}
test('editor changes create a new draft and block publishing unsaved changes', async ({ page }) => {
  await mock(page);
  let body: any;
  await page.route('**/api/game-templates/builtin-cs16/versions', async (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({ json: { ...row, version: 2, document: body.document } });
  });
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('CS community');
  await expect(page.getByRole('button', { name: 'Publish v1', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Network', exact: true }).click();
  await expect(page.getByLabel('Container port', { exact: true })).toHaveValue('27015');
  await page.getByRole('button', { name: 'Save new draft version' }).click();
  await expect(page.getByRole('status')).toContainText('Draft v2 saved');
  expect(body.document.name).toBe('CS community');
  expect(body.baseVersion).toBe(1);
  expect(body.document.ports).toHaveLength(1);
});
test('native lifecycle editor upgrades only the draft and preserves literal startup arguments', async ({ page }) => {
  await mock(page);
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('tab', { name: 'Lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Use Native Runtime in this draft' }).click();
  await page.getByLabel('Startup arguments', { exact: true }).fill('/data/server\n--name\n{{SERVER_NAME}}');
  await page.getByRole('button', { name: 'Add install step', exact: true }).click();
  await expect(page.getByLabel('Step name', { exact: true })).toHaveValue('New step');
  await page.getByRole('tab', { name: 'Json', exact: true }).click();
  const document = JSON.parse(await page.getByLabel('Template JSON').inputValue());
  expect(document.schemaVersion).toBe(2);
  expect(document.runtime.provider).toBe('external');
  expect(document.runtime.image).toBe('');
  expect(document.lifecycle.startup).toEqual(['/data/server', '--name', '{{SERVER_NAME}}']);
  expect(document.lifecycle.install).toHaveLength(1);
  expect(document.ports[0].linuxgsmKey).toBe('');
  await expect(page.getByRole('button', { name: 'Publish v1', exact: true })).toBeDisabled();
});
test('remote installation sends a signed ticket and explicit bindings, never a client-supplied image', async ({
  page,
}) => {
  await mock(page, 'published');
  let body: any;
  let prepared: any;
  await page.route('**/api/health', (r) => r.fulfill({ json: { templatesProtocol: 1 } }));
  await page.route('**/prepare', (r) => {
    prepared = r.request().postDataJSON();
    return r.fulfill({ json: { ticket: 'test-ticket' } });
  });
  await page.route('**/api/nodes/test-node/runtime/api/servers/install', (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({ status: 201, json: { server: { id: 7 } } });
  });
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Install server' }).click();
  await page.getByRole('combobox', { name: 'Execution node' }).click();
  await page.getByRole('option', { name: 'Test node · Test location' }).click();
  await page.getByRole('combobox', { name: /Host IP/ }).click();
  await page.getByRole('option', { name: /Game IP/ }).click();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Server #7 created');
  expect(prepared.nodeId).toBe('test-node');
  expect(body.templateTicket).toBe('test-ticket');
  expect(body.bindings).toEqual([{ key: 'game', host: 27015, hostIp: '192.0.2.10' }]);
  expect(body.dockerImage).toBeUndefined();
});
test('old agents are rejected before submitting an installation', async ({ page }) => {
  await mock(page, 'published');
  let sends = 0;
  await page.route('**/api/health', (r) => r.fulfill({ json: { status: 'healthy' } }));
  await page.route('**/api/servers/install', (r) => {
    sends++;
    return r.fulfill({ json: {} });
  });
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Install server' }).click();
  await page.getByRole('combobox', { name: /Host IP/ }).click();
  await page.getByRole('option', { name: /Game IP/ }).click();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Update this node agent');
  expect(sends).toBe(0);
});
test('mobile dark editor and custom dropdown stay within the viewport', async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/templates.fixture.html');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('tab', { name: 'Network', exact: true }).click();
  await page.getByRole('combobox', { name: 'Protocol', exact: true }).click();
  await expect(page.getByRole('option', { name: 'UDP', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/templates-dark-mobile.png', fullPage: true });
});
test('invalid advanced JSON does not crash the editor or get published', async ({ page }) => {
  await mock(page);
  await page.route('**/api/game-templates/validate', (r) =>
    r.fulfill({ status: 400, json: { error: 'Unsupported template schema' } })
  );
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('tab', { name: 'Json', exact: true }).click();
  await page.getByLabel('Template JSON').fill('{}');
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unsupported template schema');
  await expect(page.getByLabel('Template JSON')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish v1', exact: true })).toBeDisabled();
});
