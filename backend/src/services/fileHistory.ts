import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileVersion } from './atomicFile.js';
const MAX_SNAPSHOT = 512 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const TTL = 30 * 24 * 60 * 60 * 1000;
export interface FileHistoryScope { root: string; path: string }
export interface FileHistoryRecord {
  id: string; createdAt: string; actor: string; state: 'prepared' | 'committed';
  before: string; after: string; beforeVersion: string; afterVersion: string;
}
const scopeKey = (scope: FileHistoryScope) => createHash('sha256').update(JSON.stringify([scope.root, scope.path])).digest('hex');
const validId = /^[a-f0-9]{64}-[0-9]{13}-[a-f0-9-]{36}\.json$/;
async function inspectDirectory(directory: string, create = false) {
  if (create) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat && !stat.isDirectory()) throw new Error('Invalid file history directory');
  return stat;
}
async function writeRecord(directory: string, record: FileHistoryRecord) {
  const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, path.join(directory, record.id));
    const handleDir = await fs.open(directory, 'r'); try { await handleDir.sync(); } finally { await handleDir.close(); }
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
async function inventory(directory: string) {
  if (!await inspectDirectory(directory)) return [];
  const names = await fs.readdir(directory);
  if (names.length > 1000) throw new Error('File history limit exceeded');
  const records = [];
  for (const name of names.filter(name => validId.test(name))) {
    const stat = await fs.lstat(path.join(directory, name));
    if (!stat.isFile()) throw new Error('Invalid file history entry');
    records.push({ name, bytes: stat.size, time: Number(name.slice(65, 78)) });
  }
  return records;
}
export async function prepareFileHistory(directory: string, scope: FileHistoryScope, actor: string, beforeBytes: Buffer, after: string) {
  if (beforeBytes.byteLength > MAX_SNAPSHOT || Buffer.byteLength(after) > MAX_SNAPSHOT) throw new Error('History supports text snapshots up to 512 KiB');
  const before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(beforeBytes);
  const now = Date.now();
  const record: FileHistoryRecord = { id: `${scopeKey(scope)}-${now}-${randomUUID()}.json`, createdAt: new Date(now).toISOString(), actor, state: 'prepared', before, after, beforeVersion: fileVersion(beforeBytes), afterVersion: fileVersion(after) };
  await inspectDirectory(directory, true);
  const entries = await inventory(directory);
  for (const entry of entries.filter(entry => entry.time < now - TTL)) await fs.unlink(path.join(directory, entry.name));
  const size = entries.filter(entry => entry.time >= now - TTL).reduce((total, entry) => total + entry.bytes, 0);
  if (size + Buffer.byteLength(JSON.stringify(record)) > MAX_TOTAL) throw new Error('File history storage limit reached');
  await writeRecord(directory, record);
  await pruneHistory(directory);
  return record;
}
export async function commitFileHistory(directory: string, record: FileHistoryRecord) {
  await inspectDirectory(directory);
  await writeRecord(directory, { ...record, state: 'committed' });
  await pruneHistory(directory);
}
async function pruneHistory(directory: string) {
  const entries = (await inventory(directory)).sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  const perFile = new Map<string, number>();
  let kept = 0;
  for (const entry of entries) {
    const key = entry.name.slice(0, 64); const count = perFile.get(key) || 0;
    if (count >= 10 || kept >= 100 || entry.time < Date.now() - TTL) await fs.unlink(path.join(directory, entry.name));
    else { perFile.set(key, count + 1); kept++; }
  }
}
export async function readFileHistory(directory: string, scope: FileHistoryScope, id: string): Promise<FileHistoryRecord> {
  if (!validId.test(id) || !id.startsWith(scopeKey(scope) + '-')) throw Object.assign(new Error('History entry not found'), { statusCode: 404 });
  if (!await inspectDirectory(directory)) throw Object.assign(new Error('History entry not found'), { statusCode: 404 });
  const filename = path.join(directory, id); const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024 + 8192) throw new Error('Invalid history entry');
  const record = JSON.parse(await fs.readFile(filename, 'utf8')) as FileHistoryRecord;
  if (record.id !== id || !['prepared', 'committed'].includes(record.state) || typeof record.before !== 'string' || typeof record.after !== 'string' || typeof record.actor !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || Date.parse(record.createdAt) !== Number(id.slice(65, 78)) || Date.parse(record.createdAt) > Date.now() + 5000 || Date.parse(record.createdAt) < Date.now() - TTL || fileVersion(record.before) !== record.beforeVersion || fileVersion(record.after) !== record.afterVersion) throw new Error('History entry is invalid or expired');
  return record;
}
export async function listFileHistory(directory: string, scope: FileHistoryScope) {
  const entries = (await inventory(directory)).filter(entry => entry.name.startsWith(scopeKey(scope) + '-') && entry.time >= Date.now() - TTL).sort((a, b) => b.time - a.time || b.name.localeCompare(a.name)).slice(0, 10);
  return Promise.all(entries.map(async entry => {
    const { before, after, ...record } = await readFileHistory(directory, scope, entry.name);
    return { ...record, beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after) };
  }));
}
