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
  await page.route('**/api/servers/available-ports?*', (r) =>
    r.fulfill({ json: { ports: [27015, 27017, 27020] } })
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
test('native lifecycle editor upgrades only the draft and preserves literal startup arguments', async ({
  page,
}) => {
  await mock(page);
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('tab', { name: 'Lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Use Native Runtime in this draft' }).click();
  const startup = page.getByRole('group', { name: 'Startup arguments', exact: true });
  for (const [i, value] of ['/data/server', '--name', '{{SERVER_NAME}}'].entries()) {
    if (i > 0) await startup.getByRole('button', { name: 'Add argument', exact: true }).click();
    await page.getByLabel(`Startup arguments argument ${i}`, { exact: true }).fill(value);
  }
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

test('script editor stores installer image and literal source in a new version, including on mobile', async ({ page }) => {
  await mock(page);
  let saved: any;
  await page.route('**/api/game-templates/builtin-cs16/versions', async r => {
    saved = r.request().postDataJSON().document;
    return r.fulfill({ json: { ...row, version: 2, document: saved } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/templates.fixture.html');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await page.getByRole('tab', { name: 'Lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Use Native Runtime in this draft' }).click();
  await page.getByLabel('Installer image (optional)', { exact: true }).fill('gamepanel-installer:steamcmd-v1');
  await page.getByRole('button', { name: 'Add install script', exact: true }).click();
  const source = '#!/bin/bash\nprintf "%s" "${MAP}"\n# {{MAP}} is not replaced\n';
  await page.getByLabel('install script 1', { exact: true }).fill(source);
  await expect(page.getByRole('button', { name: 'Publish v1', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/template-scripts-dark-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Save new draft version' }).click();
  await expect(page.getByRole('status')).toContainText('Draft v2 saved');
  expect(saved.lifecycle.installerImage).toBe('gamepanel-installer:steamcmd-v1');
  expect(saved.lifecycle.install[0].script).toBe(source);
  expect(saved.lifecycle.install[0].argv).toBeUndefined();
});

test('scripted templates reject older native agents before authorization or installation', async ({ page }) => {
  await mock(page, 'published');
  const document = { ...definition, schemaVersion: 2, runtime: { ...definition.runtime, provider: 'external' }, lifecycle: {
    startup: ['/data/server'], workdir: '/data', install: [{ name: 'Install', script: 'echo install', timeoutSeconds: 30 }], update: [], stopSignal: 'SIGTERM', stopTimeoutSeconds: 30,
  } };
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [{ ...row, status: 'published', document }] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { templatesProtocol: 1, nativeRuntimeProtocol: 1 } }));
  let sends = 0;
  await page.route('**/prepare', r => { sends++; return r.fulfill({ json: {} }); });
  await openNetwork(page);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('does not support template scripts');
  expect(sends).toBe(0);
});

test('native configuration links require the settings contract before creating a ticket', async ({ page }) => {
  await mock(page, 'published');
  const document = { ...definition, schemaVersion: 2, runtime: { ...definition.runtime, provider: 'external' },
    configFiles: [{ root: 'data', path: '/serverfiles/cstrike/server.cfg', label: 'Server settings' }],
    lifecycle: { startup: ['/data/serverfiles/hlds_linux'], workdir: '/data', install: [], update: [], stopSignal: 'SIGINT', stopTimeoutSeconds: 30 },
  };
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [{ ...row, status: 'published', document }] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { templatesProtocol: 1, nativeRuntimeProtocol: 1, templateScriptsProtocol: 1 } }));
  let sends = 0;
  await page.route('**/prepare', r => { sends++; return r.fulfill({ json: {} }); });
  await page.route('**/api/servers/install', r => { sends++; return r.fulfill({ json: {} }); });
  await openNetwork(page);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('native settings update');
  expect(sends).toBe(0);
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
  await page.route('**/api/nodes/test-node/runtime/api/servers/7', r => r.fulfill({ json: { server: { id: 7, status: 'installing', installProgress: { status: 'installing', progress: 25 } } } }));
  await page.route('**/api/nodes/test-node/runtime/api/servers/install', (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({ status: 201, json: { server: { id: 7 } } });
  });
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Install server' }).click();
  await page.getByRole('combobox', { name: 'Execution node' }).click();
  await page.getByRole('option', { name: 'Test node · Test location' }).click();
  await page.getByRole('combobox', { name: /Public IP/ }).click();
  await page.getByRole('option', { name: /Game IP/ }).click();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.locator('.gp-install-status__badge')).toHaveText('Installing');
  expect(prepared.nodeId).toBe('test-node');
  expect(body.templateTicket).toBe('test-ticket');
  expect(body.bindings).toEqual([{ key: 'game', host: 'auto', hostIp: '192.0.2.10' }]);
  expect(body.dockerImage).toBeUndefined();
});
test('native installation uses the shared progress modal and resumes status after reload', async ({ page }) => {
  await mock(page, 'published');
  const document = { ...definition, schemaVersion: 2, runtime: { ...definition.runtime, provider: 'external' }, lifecycle: {
    startup: ['/data/server'], workdir: '/data', install: [{ name: 'Download Steam files and install ReHLDS', script: 'echo install', timeoutSeconds: 30 }], update: [], stopSignal: 'SIGTERM', stopTimeoutSeconds: 30,
  } };
  await page.route('**/api/game-templates', r => r.fulfill({ json: { templates: [{ ...row, status: 'published', document }] } }));
  await page.route('**/api/health', r => r.fulfill({ json: { templatesProtocol: 1, nativeRuntimeProtocol: 1, templateScriptsProtocol: 1 } }));
  await page.route('**/prepare', r => r.fulfill({ json: { ticket: 'test' } }));
  await page.route('**/api/servers/install', r => r.fulfill({ json: { server: { id: 8 } } }));
  let status = 'native_step_0';
  await page.route('**/api/servers/8', r => r.fulfill({ json: { server: { installProgress: { progress: status === 'completed' ? 100 : 25, status } } } }));
  await openNetwork(page);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Download Steam files and install ReHLDS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Logs / Console', exact: true })).toBeEnabled();
  const logsButton = page.getByRole('button', { name: 'Open Logs / Console', exact: true });
  const closeButton = page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true });
  const logsDesktop = (await logsButton.boundingBox())!;
  const closeDesktop = (await closeButton.boundingBox())!;
  expect(closeDesktop.x - (logsDesktop.x + logsDesktop.width)).toBeGreaterThanOrEqual(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await closeButton.scrollIntoViewIfNeeded();
  const logsMobile = (await logsButton.boundingBox())!;
  const closeMobile = (await closeButton.boundingBox())!;
  expect(closeMobile.y - (logsMobile.y + logsMobile.height)).toBeGreaterThanOrEqual(12);
  expect(Math.abs(logsMobile.width - closeMobile.width)).toBeLessThanOrEqual(1);
  expect(logsMobile.x).toBeGreaterThanOrEqual(0);
  expect(logsMobile.x + logsMobile.width).toBeLessThanOrEqual(390);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/native-install-mobile-actions.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: 'Install server' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  status = 'completed';
  await expect(page.getByRole('heading', { name: 'Installation completed', exact: true })).toBeVisible();
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/native-install-completed.png' });
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
  await page.getByRole('combobox', { name: /Public IP/ }).click();
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
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/templates-dark-mobile.png', fullPage: true });
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

async function openNetwork(page: import('@playwright/test').Page) {
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Install server' }).click();
  await page.getByRole('combobox', { name: /Public IP/ }).click();
  await page.getByRole('option', { name: /Game IP/ }).click();
}

test('public port dropdown excludes unavailable ports, hides container details and submits manual selection', async ({
  page,
}) => {
  await mock(page, 'published');
  let body: any;
  await page.route('**/api/health', (r) => r.fulfill({ json: { templatesProtocol: 1 } }));
  await page.route('**/prepare', (r) => r.fulfill({ json: { ticket: 'ticket' } }));
  await page.route('**/api/servers/install', (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({
      status: 201,
      json: { server: { id: 9, ports: { tcp: [], udp: [{ hostIp: '192.0.2.10', host: 27020 }] } } },
    });
  });
  await openNetwork(page);
  await expect(page.getByText('192.0.2.10:27015', { exact: true })).toBeVisible();
  await expect(page.getByText(/container port|Host port → container/i)).toHaveCount(0);
  await page.getByRole('combobox', { name: /Public port/ }).click();
  await expect(page.getByRole('option', { name: '27016', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: '27020', exact: true }).click();
  await expect(page.getByText('192.0.2.10:27020', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.locator('.gp-install-status')).toContainText('192.0.2.10:27020');
  expect(body.bindings).toEqual([{ key: 'game', hostIp: '192.0.2.10', host: 27020 }]);
});

test('occupied selection refreshes on 409 and requires a fresh selection, without automatic resubmission', async ({
  page,
}) => {
  await mock(page, 'published');
  let busy = false,
    sends = 0;
  await page.route('**/api/servers/available-ports?*', (r) =>
    r.fulfill({ json: { ports: busy ? [27020] : [27015, 27020] } })
  );
  await page.route('**/api/health', (r) => r.fulfill({ json: { templatesProtocol: 1 } }));
  await page.route('**/prepare', (r) => r.fulfill({ json: { ticket: 'ticket' } }));
  await page.route('**/api/servers/install', (r) => {
    busy = true;
    sends++;
    return r.fulfill({ status: 409, json: { error: 'Port already reserved' } });
  });
  await openNetwork(page);
  await page.getByRole('combobox', { name: /Public port/ }).click();
  await page.getByRole('option', { name: '27015', exact: true }).click();
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(
    page.getByText('Selected port is no longer available. Choose another port.')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeDisabled();
  expect(sends).toBe(1);
  await page.getByRole('combobox', { name: /Public port/ }).click();
  await page.getByRole('option', { name: '27020', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeEnabled();
});

test('empty pools and failed checks block installation; refresh recovers', async ({ page }) => {
  await mock(page, 'published');
  let state = 0;
  await page.route('**/api/servers/available-ports?*', (r) =>
    state === 0
      ? r.fulfill({ json: { ports: [] } })
      : state === 1
        ? r.fulfill({ status: 503, json: { error: 'Node unavailable' } })
        : r.fulfill({ json: { ports: [27020] } })
  );
  await openNetwork(page);
  await expect(page.getByText(/No free ports in this pool/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeDisabled();
  state = 1;
  await page.getByRole('button', { name: 'Refresh ports' }).click();
  await expect(page.getByRole('alert')).toContainText('Node unavailable');
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeDisabled();
  state = 2;
  await page.getByRole('button', { name: 'Refresh ports' }).click();
  await expect(page.getByText('192.0.2.10:27020', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeEnabled();
});

test('large pools use bounded custom options with search and fit a dark mobile viewport', async ({
  page,
}) => {
  await mock(page, 'published');
  await page.route('**/api/servers/available-ports?*', (r) =>
    r.fulfill({ json: { ports: Array.from({ length: 64511 }, (_, i) => i + 1025) } })
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await openNetwork(page);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('combobox', { name: /Public port/ }).click();
  expect(await page.getByRole('option').count()).toBeLessThanOrEqual(51);
  await expect(page.getByRole('option', { name: 'Assign automatically', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: /Public port/ }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByLabel(/Find port/).fill('65535');
  await page.getByRole('combobox', { name: /Public port/ }).focus();
  await page.getByRole('combobox', { name: /Public port/ }).press('ArrowDown');
  await page.getByRole('option', { name: '65535', exact: true }).click();
  await expect(page.getByText('192.0.2.10:65535', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.PLAYWRIGHT_SCREENSHOTS === '1') await page.screenshot({ path: 'test-results/public-ports-dark-mobile.png', fullPage: true });
});

test('late local response cannot overwrite remote node availability', async ({ page }) => {
  await mock(page, 'published');
  let finish!: () => void;
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  let started!: () => void;
  const pending = new Promise<void>((r) => {
    started = r;
  });
  await page.route('**/api/servers/available-ports?*', async (r) => {
    if (r.request().url().includes('/test-node/runtime/'))
      return r.fulfill({ json: { ports: [27020] } });
    started();
    await gate;
    await r.fulfill({ json: { ports: [27015] } });
  });
  await openNetwork(page);
  await pending;
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Execution node' }).click();
  await page.getByRole('option', { name: 'Test node · Test location' }).click();
  await page.getByRole('combobox', { name: /Public IP/ }).click();
  await page.getByRole('option', { name: /Game IP/ }).click();
  await expect(page.getByText('192.0.2.10:27020', { exact: true })).toBeVisible();
  finish();
  await expect(page.getByText('192.0.2.10:27015', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create server', exact: true })).toBeEnabled();
});

test('game icon library and custom upload persist in a new template version', async ({ page }) => {
  await mock(page);
  let saved: any;
  await page.route('**/api/game-templates/builtin-cs16/versions', route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { ...row, version: 2, document: saved.document } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/templates.fixture.html');
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  const icons = page.getByRole('group', { name: 'Game icon', exact: true });
  await icons.getByRole('button', { name: 'Counter-Strike: Global Offensive', exact: true }).click();
  await expect(icons.getByRole('button', { name: 'Counter-Strike: Global Offensive', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save new draft version' }).click();
  await expect.poll(() => saved?.document.icon).toBe('counter-strike-go');
  await expect(page.getByRole('status').filter({ hasText: 'Draft v2 saved' })).toBeVisible();
  await icons.getByLabel('Upload your own icon').setInputFiles({ name: 'my-icon.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAq0lEQVR4nOXOIQEAAAgDsPfPRQnSnBgTiPkls32NBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HhA4wGNBzQe0HgAO0mywmjerl49AAAAAElFTkSuQmCC', 'base64') });
  await expect(icons.getByText('Custom icon selected')).toBeVisible();
  await page.getByRole('button', { name: 'Save new draft version' }).click();
  await expect.poll(() => saved?.document.icon?.startsWith('data:image/png;base64,')).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Draft v2 saved' })).toBeVisible();
  await expect(icons.locator('.gp-template-icon-preview img')).toHaveJSProperty('naturalWidth', 64);
  await page.screenshot({ path: '/tmp/gamepanel-template-icons-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await icons.getByLabel('Upload your own icon').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(icons.getByRole('alert')).toBeVisible();
  await expect(icons.getByText('Custom icon selected')).toBeVisible();
  await icons.getByRole('button', { name: 'Automatic', exact: true }).click();
  await expect(icons.getByText('Custom icon selected')).toHaveCount(0);
});

test('icon templates reject older agents before installation', async ({ page }) => {
  await mock(page, 'published');
  await page.route('**/api/game-templates', route => route.fulfill({ json: { templates: [{ ...row, status: 'published', document: { ...definition, icon: 'counter-strike-go' } }] } }));
  await page.route('**/api/health', route => route.fulfill({ json: { templatesProtocol: 1, capabilities: { gameMonitoring: 1 } } }));
  let sends = 0;
  await page.route('**/prepare', route => { sends++; return route.fulfill({ json: {} }); });
  await page.route('**/api/servers/install', route => { sends++; return route.fulfill({ json: {} }); });
  await openNetwork(page);
  await page.getByRole('button', { name: 'Create server', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Update this node to support template game icons');
  expect(sends).toBe(0);
});
