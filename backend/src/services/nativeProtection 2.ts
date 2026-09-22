import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syncDirectory } from './nativeRestoreJournal.js';

const exec = promisify(execFile);
const MAX_ARCHIVES = 2000;
export interface NativeBackupRecord {
  schema: 1;
  name: string;
  createdAt: string;
  validatedAt: string;
  mode: 'live' | 'offline';
  sizeBytes: number;
  identity: { dev: number; ino: number; mtimeMs: number; ctimeMs: number };
}
const recordPath = (archive: string) => path.join(path.dirname(archive), '.records', createHash('sha256').update(path.basename(archive)).digest('hex') + '.json');
async function directory(filename: string, missing = false) {
  const stat = await fs.lstat(filename).catch(error => { if (missing && error.code === 'ENOENT') return null; throw error; });
  if (stat && !stat.isDirectory()) throw new Error('Expected a real directory');
  return stat;
}
export async function recordNativeBackup(archive: string, live: boolean): Promise<NativeBackupRecord> {
  const stat = await fs.lstat(archive);
  if (!stat.isFile()) throw new Error('Expected a regular backup archive');
  const at = new Date().toISOString();
  const record: NativeBackupRecord = { schema: 1, name: path.basename(archive), createdAt: at, validatedAt: at, mode: live ? 'live' : 'offline', sizeBytes: stat.size, identity: { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } };
  await storeRecord(archive, record);
  return record;
}
async function storeRecord(archive: string, record: NativeBackupRecord) {
  const filename = recordPath(archive);
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await directory(path.dirname(filename));
  const temporary = filename + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, filename);
    await syncDirectory(path.dirname(filename));
    await syncDirectory(path.dirname(archive));
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
export async function moveNativeBackupRecord(source: string, target: string, record: NativeBackupRecord) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.dev !== record.identity.dev || stat.ino !== record.identity.ino || stat.size !== record.sizeBytes || stat.mtimeMs !== record.identity.mtimeMs) throw new Error('Archive changed while renaming');
  await storeRecord(target, { ...record, name: path.basename(target), identity: { ...record.identity, ctimeMs: stat.ctimeMs } });
  await forgetNativeBackupRecord(source).catch(() => {});
}
export async function readNativeBackupRecord(archive: string): Promise<NativeBackupRecord | null> {
  try {
    await directory(path.dirname(recordPath(archive)));
    const saved = await fs.lstat(recordPath(archive));
    if (!saved.isFile() || saved.size > 8192) return null;
    const record = JSON.parse(await fs.readFile(recordPath(archive), 'utf8')) as NativeBackupRecord;
    const stat = await fs.lstat(archive);
    const id = record.identity;
    if (record.schema !== 1 || record.name !== path.basename(archive) || !['live', 'offline'].includes(record.mode) || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.validatedAt)) || Date.parse(record.validatedAt) > Date.now() + 5000 || !stat.isFile() || record.sizeBytes !== stat.size || !id || id.dev !== stat.dev || id.ino !== stat.ino || id.mtimeMs !== stat.mtimeMs || id.ctimeMs !== stat.ctimeMs) return null;
    return record;
  } catch { return null; }
}
async function allocatedBytes(directories: string[]): Promise<number> {
  if (!directories.length) return 0;
  const { stdout } = await exec('du', ['-sk', ...directories], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  const lines = stdout.trim().split('\n');
  if (lines.length !== directories.length) throw new Error('Incomplete disk measurement');
  const sizes = lines.map(line => Number(line.split(/\s+/)[0]) * 1024);
  if (sizes.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid disk measurement');
  return sizes.reduce((total, value) => total + value, 0);
}
// Read-only: no mkdir, archive validation/extraction, deletion or game commands.
export async function inspectNativeProtection(dataDir: string) {
  await directory(dataDir);
  const measuredAt = new Date().toISOString();
  const warnings: string[] = [];
  const result: {
    measuredAt: string; gameAllocatedBytes: number | null; archiveBytes: number | null;
    recoveryAllocatedBytes: number | null; recoveryCount: number | null; nodeFreeBytes: number | null;
    archiveCount: number | null; unverifiedCount: number | null; latestBackup: NativeBackupRecord | null; warnings: string[];
  } = { measuredAt, gameAllocatedBytes: null, archiveBytes: null, recoveryAllocatedBytes: null, recoveryCount: null, nodeFreeBytes: null, archiveCount: null, unverifiedCount: null, latestBackup: null, warnings };
  try { const stats = await fs.statfs(dataDir); result.nodeFreeBytes = Number(stats.bavail) * Number(stats.bsize); } catch { warnings.push('Node free space is unavailable.'); }
  try { const game = path.join(dataDir, 'serverfiles'); await directory(game); result.gameAllocatedBytes = await allocatedBytes([game]); } catch { warnings.push('Game storage measurement is unavailable.'); }
  const backups = path.join(dataDir, 'backups');
  try {
    const exists = await directory(backups, true);
    const entries = exists ? await fs.readdir(backups, { withFileTypes: true }) : [];
    if (entries.length > MAX_ARCHIVES) throw new Error('Too many entries');
    const archives = entries.filter(entry => entry.isFile() && entry.name.endsWith('.tar.gz'));
    const recovery = entries.filter(entry => entry.isDirectory() && /^recovery-[0-9a-f-]+$/.test(entry.name));
    result.archiveCount = archives.length; result.archiveBytes = 0; result.unverifiedCount = 0; result.recoveryCount = recovery.length;
    for (const entry of archives) {
      const filename = path.join(backups, entry.name);
      const stat = await fs.lstat(filename);
      if (!stat.isFile()) throw new Error('Archive changed during scan');
      result.archiveBytes += stat.size;
      const record = await readNativeBackupRecord(filename);
      if (!record) result.unverifiedCount++;
      else if (!result.latestBackup || record.createdAt > result.latestBackup.createdAt) result.latestBackup = record;
    }
    try { result.recoveryAllocatedBytes = await allocatedBytes(recovery.map(entry => path.join(backups, entry.name))); }
    catch { warnings.push('Recovery storage measurement is unavailable.'); }
  } catch {
    result.archiveCount = result.archiveBytes = result.recoveryCount = result.recoveryAllocatedBytes = result.unverifiedCount = null;
    result.latestBackup = null;
    warnings.push('Backup storage could not be fully inspected.');
  }
  return result;
}

export async function forgetNativeBackupRecord(archive: string) {
  await directory(path.dirname(recordPath(archive)));
  await fs.unlink(recordPath(archive));
}
