// Headless only: no screenshots, browser windows, production data or live endpoints.
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = fileURLToPath(new URL('..', import.meta.url));
const label = process.env.GP_PERF_LABEL || 'baseline';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid report label');
const runs = Number(process.env.GP_PERF_RUNS || 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use 1–10 runs');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'gp-performance-'));
const fixtureDist = path.join(temporary, 'fixture');
const gzip = /\bgzip\s+on;/.test(await readFile(path.join(root, 'nginx.conf'), 'utf8'));
const profile = { viewport: { width: 1365, height: 900 }, cpuSlowdown: 4, latencyMs: 80,
  downloadBytesPerSecond: 500000, uploadBytesPerSecond: 125000, apiMockDelayMs: 20,
  compression: gzip ? 'gzip level 5 (matches repository nginx.conf)' : 'none (matches repository nginx.conf)', cache: 'disabled; fresh context per scenario',
  console: '5000 initial lines; 1000 new lines/second for 3 seconds, capped at 5000' };
await build({ root, configFile: path.join(root, 'vite.config.ts'), base: '/fixture/', logLevel: 'warn',
  build: { outDir: fixtureDist, emptyOutDir: true, rollupOptions: { input: path.join(root, 'test/server-page.fixture.html') } } });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const fixture = url.pathname.startsWith('/fixture/');
    const base = fixture ? fixtureDist : path.join(root, 'dist');
    let pathname = decodeURIComponent(fixture ? url.pathname.slice('/fixture'.length) : url.pathname);
    if (pathname === '/') pathname = '/index.html';
    let filename = path.resolve(base, '.' + pathname);
    if (!filename.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(filename).catch(() => null))?.isFile()) filename = path.join(base, 'index.html');
    let content = await readFile(filename);
    const compressed = gzip && content.length >= 1024 && /\b gzip\b|^gzip\b|,\s*gzip\b/.test(String(req.headers['accept-encoding'] || '')) && /\.(html|js|css|json|svg)$/.test(filename);
    if (compressed) content = gzipSync(content, { level: 5 });
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-store',
      ...(compressed ? { 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' } : {}) });
    res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const samples = [], errors = [];
async function contextForFixture(fixture) {
  const context = await browser.newContext({ viewport: profile.viewport });
  await context.addInitScript(({ fixture }) => {
    localStorage.setItem('theme', 'dark');
    if (fixture) { sessionStorage.setItem('gamepanel_admin_runtime', '1'); sessionStorage.setItem('gamepanel_active_node', 'local'); }
    window.__gpPerf = { lcp: null, cls: 0, longTasks: [] };
    for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === 'largest-contentful-paint') window.__gpPerf.lcp = entry.startTime;
          if (type === 'layout-shift' && !entry.hadRecentInput) window.__gpPerf.cls += entry.value;
          if (type === 'longtask') window.__gpPerf.longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
      }).observe({ type, buffered: true });
    }
  }, { fixture });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    await new Promise(resolve => setTimeout(resolve, profile.apiMockDelayMs));
    if (url.pathname === '/api/servers/7') return route.fulfill({ json: { server: { uptimeSeconds: 101340 } } });
    if (url.pathname.endsWith('/files/roots')) return route.fulfill({ json: { roots: [{ key: 'data', containerPath: '/data' }] } });
    if (url.pathname.endsWith('/file')) return route.fulfill({ headers: { etag: '"fixture-version"' }, json: { content: 'hostname performance\n'.repeat(100), version: '"fixture-version"' } });
    if (url.pathname.endsWith('/files')) return route.fulfill({ json: { entries: [{ name: 'server.cfg', type: 'file' }] } });
    return route.fulfill({ json: { nodes: [], entries: [], settings: {} } });
  });
  // Never allow a fixture to reach an external host.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latencyMs,
    downloadThroughput: profile.downloadBytesPerSecond, uploadThroughput: profile.uploadBytesPerSecond });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuSlowdown });
  return { context, page };
}
async function snapshot(page) {
  return page.evaluate(() => ({ readyMs: performance.now(), fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
    lcpMs: window.__gpPerf.lcp, cls: window.__gpPerf.cls,
    blockingMs: window.__gpPerf.longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
    resources: performance.getEntriesByType('resource').filter(entry => /\.(js|css)(\?|$)/.test(entry.name)).map(entry => ({ name: new URL(entry.name).pathname, bytes: entry.decodedBodySize, encodedBytes: entry.encodedBodySize, durationMs: entry.duration })) }));
}
try {
  for (let run = 1; run <= runs; run++) {
    const login = await contextForFixture(false);
    await login.page.goto(origin, { waitUntil: 'domcontentloaded' });
    await login.page.getByRole('button', { name: /sign in/i }).waitFor();
    samples.push({ run, scenario: 'production-login', ...await snapshot(login.page) });
    await login.context.close();
    const { context, page } = await contextForFixture(true);
    await page.goto(origin+'/fixture/test/server-page.fixture.html?performance#/nodes/local/servers/7/console', { waitUntil: 'domcontentloaded' });
    await page.getByText('Server ready for players', { exact: true }).waitFor();
    samples.push({ run, scenario: 'production-server-fixture', ...await snapshot(page) });
    const editorStart = await page.evaluate(() => performance.now());
    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await page.getByText('server.cfg', { exact: true }).dblclick();
    await page.locator('.monaco-editor:visible').waitFor();
    samples.push({ run, scenario: 'first-editor', durationMs: await page.evaluate(start => performance.now() - start, editorStart) });
    await page.getByRole('link', { name: 'Console', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('gp-performance-logs', { detail: 5000 })));
    await page.getByText('Performance log 5000: player event completed successfully', { exact: true }).waitFor();
    const streamStart = await page.evaluate(() => {
      const start = performance.now(); let batches = 0;
      window.__gpPerfStream = setInterval(() => {
        window.dispatchEvent(new CustomEvent('gp-performance-logs', { detail: 100 }));
        if (++batches === 30) clearInterval(window.__gpPerfStream);
      }, 100); return start;
    });
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.locator('.gp-console-panel[data-fullscreen=true]').waitFor();
    const interactionMs = await page.evaluate(start => performance.now() - start, streamStart);
    await page.getByText('Performance log 8000: player event completed successfully', { exact: true }).waitFor();
    const stream = await page.evaluate(start => ({ durationMs: performance.now() - start,
      blockingMs: window.__gpPerf.longTasks.filter(t => t.start >= start).reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
      domElements: document.querySelectorAll('*').length }), streamStart);
    samples.push({ run, scenario: 'console-stream', interactionMs, ...stream });
    await context.close(); console.log(`Performance run ${run}/${runs} complete`);
  }
  const report = { label, createdAt: new Date().toISOString(), profile, environment: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, browser: browser.version(), node: process.version },
    limitations: ['Synthetic local measurements, not field Core Web Vitals or WAW timings.', 'Login uses the actual production bundle; server/editor/console use a production-built AppShell fixture with mocked API.', 'No screenshots or traces containing screenshots; external hosts blocked.'], samples, errors };
  const output = path.join(root, '..', 'docs/pro/performance'); await mkdir(output, { recursive: true });
  await writeFile(path.join(output, label+'.json'), JSON.stringify(report, null, 2)+'\n');
  console.log(`Report: docs/pro/performance/${label}.json`);
  if (errors.length) throw new Error(`Browser reported ${errors.length} errors; review report`);
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
