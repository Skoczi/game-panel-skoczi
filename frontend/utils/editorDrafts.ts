// Text drafts only. Never store authentication data or terminal history here.
export const DRAFT_PREFIX = 'gp_editor_draft_v1:';
const EPOCH_KEY = 'gp_editor_draft_epoch';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECORD_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 20;
export interface DraftScope { userId: string; serverId: string; nodeId: string }
export interface EditorDraft extends DraftScope {
  root: string; path: string; version: string; content: string; saved: string; updatedAt: number;
}
function browserStorage(): Storage {
  try { return localStorage; }
  catch {
    return { length: 0, key: () => null, clear: () => {}, removeItem: () => {},
      getItem: () => { throw new Error('Storage unavailable'); },
      setItem: () => { throw new Error('Storage unavailable'); } };
  }
}
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const keyFor = (record: EditorDraft) => DRAFT_PREFIX + JSON.stringify([record.userId, record.serverId, record.nodeId, record.root, record.path, record.version]);
const matches = (a: EditorDraft, scope: DraftScope, root: string, path: string) =>
  a.userId === scope.userId && a.serverId === scope.serverId && a.nodeId === scope.nodeId && a.root === root && a.path === path;
function records(storage: Storage, now: number): Array<{ key: string; value: EditorDraft; size: number }> {
  const result = [];
  for (const key of Object.keys(storage).filter(key => key.startsWith(DRAFT_PREFIX))) {
    try {
      const raw = storage.getItem(key)!;
      const value = JSON.parse(raw) as EditorDraft;
      if (!['userId', 'serverId', 'nodeId', 'root', 'path', 'version', 'content', 'saved'].every(field => typeof value[field as keyof EditorDraft] === 'string')
        || !Number.isFinite(value.updatedAt) || value.updatedAt > now + 5000 || now - value.updatedAt > DRAFT_TTL_MS
        || bytes(raw) > MAX_RECORD_BYTES || key !== keyFor(value)) throw new Error('Invalid draft');
      result.push({ key, value, size: bytes(raw) });
    } catch { storage.removeItem(key); }
  }
  return result;
}
export function draftEpoch(storage = browserStorage()): string {
  try {
    const existing = storage.getItem(EPOCH_KEY);
    if (existing) return existing;
    const epoch = crypto.randomUUID();
    storage.setItem(EPOCH_KEY, epoch);
    return epoch;
  } catch { return 'unavailable'; }
}
export function readEditorDraft(scope: DraftScope, root: string, path: string, storage = browserStorage(), now = Date.now()): EditorDraft | undefined {
  try { return records(storage, now).filter(entry => matches(entry.value, scope, root, path)).sort((a, b) => b.value.updatedAt - a.value.updatedAt)[0]?.value; }
  catch { return undefined; }
}
export function removeEditorDraft(scope: DraftScope, root: string, path: string, storage = browserStorage()) {
  try { for (const entry of records(storage, Date.now())) if (matches(entry.value, scope, root, path)) storage.removeItem(entry.key); } catch { /* Storage may be disabled. */ }
}
export function saveEditorDraft(value: EditorDraft, epoch: string, storage = browserStorage()): boolean {
  try {
    if (!value.version || draftEpoch(storage) !== epoch || epoch === 'unavailable') return false;
    const raw = JSON.stringify(value);
    if (bytes(raw) > MAX_RECORD_BYTES) return false;
    const others = records(storage, Date.now()).filter(entry => !matches(entry.value, value, value.root, value.path));
    if (others.length >= MAX_RECORDS || others.reduce((sum, entry) => sum + entry.size, 0) + bytes(raw) > MAX_TOTAL_BYTES) return false;
    // Write first: on quota errors the previous draft remains recoverable.
    storage.setItem(keyFor(value), raw);
    for (const entry of records(storage, Date.now())) if (matches(entry.value, value, value.root, value.path) && entry.key !== keyFor(value)) storage.removeItem(entry.key);
    return true;
  } catch { return false; }
}
export function clearEditorDrafts(storage = browserStorage()) {
  try {
    for (const key of Object.keys(storage)) if (key.startsWith(DRAFT_PREFIX)) storage.removeItem(key);
    storage.setItem(EPOCH_KEY, crypto.randomUUID());
  } catch { /* Storage may be disabled. */ }
}
