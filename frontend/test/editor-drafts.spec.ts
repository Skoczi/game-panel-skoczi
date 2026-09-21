import { test, expect } from '@playwright/test';
import { DRAFT_TTL_MS, draftEpoch, readEditorDraft, saveEditorDraft, clearEditorDrafts, removeEditorDraft } from '../utils/editorDrafts';
function memoryStorage(): Storage {
  const value: any = {};
  Object.defineProperties(value, {
    length: { get: () => Object.keys(value).length },
    getItem: { value: (key: string) => value[key] ?? null },
    setItem: { value: (key: string, item: string) => { value[key] = item; } },
    removeItem: { value: (key: string) => { delete value[key]; } },
    key: { value: (index: number) => Object.keys(value)[index] ?? null },
  });
  return value;
}
const scope = { userId: '1', serverId: 'global-one', nodeId: 'local' };
const draft = () => ({ ...scope, root: 'data', path: '/server.cfg', version: '"v1"', content: 'my edits', saved: 'original', updatedAt: Date.now() });

test('drafts are isolated by user, global server, node and path and expire', () => {
  const store = memoryStorage(); const value = draft();
  expect(saveEditorDraft(value, draftEpoch(store), store)).toBe(true);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)?.content).toBe('my edits');
  for (const other of [{ ...scope, userId: '2' }, { ...scope, serverId: 'global-two' }, { ...scope, nodeId: 'remote' }])
    expect(readEditorDraft(other, 'data', '/server.cfg', store)).toBeUndefined();
  expect(readEditorDraft(scope, 'config', '/server.cfg', store)).toBeUndefined();
  expect(readEditorDraft(scope, 'data', '/other.cfg', store)).toBeUndefined();
  expect(readEditorDraft(scope, 'data', '/server.cfg', store, value.updatedAt + DRAFT_TTL_MS + 1)).toBeUndefined();
});

test('oversized drafts do not replace recoverable text; discard and logout remove it', () => {
  const store = memoryStorage(); const epoch = draftEpoch(store);
  expect(saveEditorDraft(draft(), epoch, store)).toBe(true);
  expect(saveEditorDraft({ ...draft(), content: 'x'.repeat(600 * 1024) }, epoch, store)).toBe(false);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)?.content).toBe('my edits');
  removeEditorDraft(scope, 'data', '/server.cfg', store);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)).toBeUndefined();
  saveEditorDraft(draft(), epoch, store);
  clearEditorDrafts(store);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)).toBeUndefined();
  expect(saveEditorDraft(draft(), epoch, store)).toBe(false);
});

for (const changed of [false, true]) test(`editor recovers a local draft after reload; remote changed=${changed}`, async ({ page }) => {
  let version = '"v1"'; let content = 'hostname original'; let writes = 0;
  await page.addInitScript(() => sessionStorage.setItem('gamepanel_active_server', JSON.stringify({ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', nodeId: 'local', runtimeId: 7, name: 'CS16 Test', location: '', nodeName: 'Local', permissions: ['*'], placementRevision: 1 })));
  await page.route('**/api/servers/7/files?**', route => route.fulfill({ json: { entries: [{ name: 'server.cfg', type: 'file' }] } }));
  await page.route('**/api/servers/7/file?**', route => {
    if (route.request().method() !== 'GET') { writes++; return route.fulfill({ json: { ok: true, version: '"v3"' } }); }
    return route.fulfill({ headers: { etag: version }, body: content });
  });
  await page.goto('/test/server-page.fixture.html#/nodes/local/servers/7/filemanager');
  await page.getByText('server.cfg', { exact: true }).dblclick();
  await page.locator('.monaco-editor:visible').click();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('hostname local draft');
  await expect(page.getByText(/Draft saved locally/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('gp_editor_draft_v1:')).map(key => JSON.parse(localStorage.getItem(key)!).content))).toEqual(['hostname local draft']);
  if (changed) { version = '"v2"'; content = 'hostname remote'; }
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await page.getByText('server.cfg', { exact: true }).dblclick();
  await expect(page.locator('.monaco-editor:visible')).toContainText('hostname local draft');
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('gp_editor_draft_v1:')).length)).toBe(0);
});

test('storage write failure preserves the previous draft and never touches another user’s records', () => {
  const store = memoryStorage(); const epoch = draftEpoch(store);
  saveEditorDraft(draft(), epoch, store);
  const blocked = new Proxy(store, { get(target, prop) {
    if (prop === 'setItem') return () => { throw new Error('QuotaExceededError'); };
    return Reflect.get(target, prop);
  } });
  expect(saveEditorDraft({ ...draft(), content: 'newer' }, epoch, blocked)).toBe(false);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)?.content).toBe('my edits');
  removeEditorDraft({ ...scope, userId: '2' }, 'data', '/server.cfg', store);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)?.content).toBe('my edits');
});


test('logout removes drafts even when writing a new epoch fails', () => {
  const store = memoryStorage();
  saveEditorDraft(draft(), draftEpoch(store), store);
  const blocked = new Proxy(store, { get(target, prop) {
    if (prop === 'setItem') return () => { throw new Error('QuotaExceededError'); };
    return Reflect.get(target, prop);
  } });
  clearEditorDrafts(blocked);
  expect(readEditorDraft(scope, 'data', '/server.cfg', store)).toBeUndefined();
});
