import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readNativeBackupRecord, forgetNativeBackupRecord } from './nativeProtection.js';
export interface RetentionPolicy { keepArchives: number; keepRecovery: number }
interface Entry { name: string; kind: 'archive' | 'recovery'; sizeBytes: number | null; modifiedAt: string; protectedReason: string | null; identity: string }
const identity = (stat: Awaited<ReturnType<typeof fs.lstat>>) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const error = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
export function validateRetentionPolicy(value: RetentionPolicy) {
  if (![value.keepArchives, value.keepRecovery].every(count => Number.isSafeInteger(count) && count >= 1 && count <= 100)) throw error('Keep between 1 and 100 archives and recovery directories.', 400);
}
async function inspectDirectory(name: string, missing = false) {
  const stat = await fs.lstat(name).catch(cause => { if (missing && cause.code === 'ENOENT') return null; throw cause; });
  if (stat && !stat.isDirectory()) throw error('Storage path is not a real directory.');
  return stat;
}
export async function planNativeRetention(dataDir: string, policy: RetentionPolicy, automaticArchivesOnly = false, protectedArchive?: string) {
  validateRetentionPolicy(policy);
  await inspectDirectory(dataDir);
  const journal = await fs.lstat(path.join(dataDir, '..', '.native-restore.json')).catch(cause => { if (cause.code === 'ENOENT') return null; throw cause; });
  if (journal) throw error('Resolve the pending restore recovery before cleaning backups.');
  const backups = path.join(dataDir, 'backups');
  const exists = await inspectDirectory(backups, true);
  const names = exists ? await fs.readdir(backups) : [];
  if (names.length > 2000) throw error('Too many backup entries for a single cleanup plan.');
  const entries: Entry[] = [];
  let latestRecord: { name: string; createdAt: string } | null = null;
  for (const name of names.sort()) {
    const filename = path.join(backups, name);
    const stat = await fs.lstat(filename);
    if (stat.isFile() && name.endsWith('.tar.gz')) {
      const record = await readNativeBackupRecord(filename);
      if (record && (!latestRecord || record.createdAt > latestRecord.createdAt || (record.createdAt === latestRecord.createdAt && record.name > latestRecord.name))) latestRecord = record;
      entries.push({ name, kind: 'archive', sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(), protectedReason: automaticArchivesOnly && !record ? 'Automatic retention keeps archives without a matching validation record' : null, identity: identity(stat) });
    } else if (stat.isDirectory() && /^recovery-[0-9a-f-]+$/.test(name)) {
      let completed = false; let manifestIdentity = 'unknown';
      try {
        const manifest = path.join(filename, 'recovery.json');
        const info = await fs.lstat(manifest);
        if (info.isFile() && info.size <= 8192) {
          manifestIdentity = identity(info);
          const record = JSON.parse(await fs.readFile(manifest, 'utf8'));
          const tree = await fs.lstat(path.join(filename, 'serverfiles'));
          completed = record.state === 'completed' && Array.isArray(record.mounts) && record.mounts.includes('serverfiles') && tree.isDirectory();
        }
      } catch { /* unknown recovery data is always retained */ }
      entries.push({ name, kind: 'recovery', sizeBytes: null, modifiedAt: stat.mtime.toISOString(), protectedReason: automaticArchivesOnly ? 'Recovery copies require manual cleanup' : completed ? null : 'Incomplete or unrecognized recovery', identity: identity(stat) + ':' + manifestIdentity });
    }
  }
  const current = entries.find(entry => entry.kind === 'archive' && entry.name === protectedArchive);
  if (protectedArchive && (!current || current.protectedReason)) throw error('New backup has no matching validation record. Automatic cleanup was cancelled.');
  if (current) current.protectedReason = 'Newly created backup';
  for (const kind of ['archive', 'recovery'] as const) {
    const sorted = entries.filter(entry => entry.kind === kind).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || b.name.localeCompare(a.name));
    const keep = kind === 'archive' ? policy.keepArchives - (current ? 1 : 0) : policy.keepRecovery;
    sorted.filter(entry => !entry.protectedReason).slice(0, keep).forEach(entry => { entry.protectedReason ||= 'Kept by retention policy'; });
  }
  const verified = entries.find(entry => entry.name === latestRecord?.name && entry.kind === 'archive');
  if (verified) verified.protectedReason = 'Latest backup with a matching validation record';
  // Bind the review to this server, policy, full inventory and filesystem identities.
  const fingerprint = createHash('sha256').update(JSON.stringify({ dataDir, policy, entries })).digest('hex');
  const visible = entries.map(({ identity: _, ...entry }) => entry);
  return { fingerprint, policy, remove: visible.filter(entry => !entry.protectedReason), keep: visible.filter(entry => entry.protectedReason) };
}
export async function applyNativeRetention(dataDir: string, policy: RetentionPolicy, fingerprint: string, automaticArchivesOnly = false, protectedArchive?: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw error('Preview the cleanup plan first.', 400);
  const fresh = await planNativeRetention(dataDir, policy, automaticArchivesOnly, protectedArchive);
  if (fresh.fingerprint !== fingerprint) throw error('Backup storage changed since the preview. Refresh the cleanup plan.');
  const removed: string[] = [];
  try {
    for (const entry of fresh.remove) {
      const filename = path.join(dataDir, 'backups', entry.name);
      if (entry.kind === 'archive') {
        await fs.unlink(filename);
        await forgetNativeBackupRecord(filename).catch(() => {});
      } else await fs.rm(filename, { recursive: true });
      removed.push(entry.name);
    }
    if (removed.length) { const handle = await fs.open(path.join(dataDir, 'backups'), 'r'); try { await handle.sync(); } finally { await handle.close(); } }
  } catch {
    throw error(`Cleanup stopped after removing ${removed.length} item(s). Refresh the backup list and preview before trying again.`);
  }
  return { removed };
}
