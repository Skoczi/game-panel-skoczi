import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { validateNativeArchive } from './nativeArchive.js';
async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export interface ExternalBackupRecord {
  schema: 1;
  runtimeUuid: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  mode: 'live' | 'offline';
  // Private recovery metadata stays on the backup volume, never in list responses.
  server: Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeName(name: string) {
  if (typeof name !== 'string' || !name.startsWith('native-') || !name.endsWith('.tar.gz')
    || path.basename(name) !== name || /[\\\x00-\x1f]/.test(name) || name.length > 240) throw new Error('Invalid external backup name');
  return name;
}
async function realDirectory(dir: string) {
  if (!(await fs.lstat(dir)).isDirectory()) throw new Error('Backup storage must be a real directory');
}
export async function requireExternalFilesystem(root: string) {
  if (!path.isAbsolute(root) || root === '/') throw new Error('Configure a dedicated external backup directory');
  await realDirectory(root);
  if (await fs.realpath(root) !== path.resolve(root)) throw new Error('External backup directory cannot contain symbolic links');
  const stat = await fs.statfs(root);
  // Reject a missing network mount that would silently fill the node disk.
  if (![0x6969, 0xff534d42, 0xfe534d42].includes(Number(stat.type) >>> 0)) throw new Error('External backup storage is not mounted as NFS or SMB');
}
async function digest(filename: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
const identity = (s: Awaited<ReturnType<typeof fs.lstat>>) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
async function copyChecked(source: string, target: string, expected?: string) {
  const before = await fs.lstat(source);
  if (!before.isFile()) throw new Error('Backup archive is not a regular file');
  const sourceHash = await digest(source);
  if (expected && sourceHash !== expected) throw new Error('External backup checksum does not match its recovery record');
  const space = await fs.statfs(path.dirname(target));
  if (Number(space.bavail) * Number(space.bsize) < before.size + 256 * 1024 ** 2) throw new Error('Backup destination needs archive size plus 256 MiB free');
  await pipeline(createReadStream(source), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  const handle = await fs.open(target, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  if (identity(before) !== identity(await fs.lstat(source)) || sourceHash !== await digest(target)) throw new Error('Backup changed during transfer or checksum verification failed');
  return { sha256: sourceHash, sizeBytes: before.size };
}

// The filesystem check can be substituted only by in-process tests. The worker
// always uses the network-filesystem guard and runs in a bounded child process.
export class ExternalBackupStore {
  constructor(private root: string, private verifyRoot = requireExternalFilesystem) {}
  async directory(runtimeUuid: string, create = false) {
    if (!uuid.test(runtimeUuid)) throw new Error('Server runtime identity is required for external backups');
    await this.verifyRoot(this.root);
    const base = path.join(this.root, 'gamepanel-v1');
    const dir = path.join(base, runtimeUuid);
    if (create) { await fs.mkdir(base, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; }); }
    await realDirectory(base);
    if (create) { await fs.mkdir(dir, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; }); }
    await realDirectory(dir);
    return dir;
  }
  async read(dir: string, name: string): Promise<ExternalBackupRecord> {
    safeName(name);
    const location = path.join(dir, name);
    await realDirectory(location);
    const meta = path.join(location, 'recovery.json');
    const stat = await fs.lstat(meta);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid external recovery record');
    const record = JSON.parse(await fs.readFile(meta, 'utf8')) as ExternalBackupRecord;
    const archive = await fs.lstat(path.join(location, 'archive.tar.gz'));
    if (record.schema !== 1 || record.name !== name || record.runtimeUuid !== path.basename(dir)
      || !/^[a-f0-9]{64}$/.test(record.sha256) || !['live', 'offline'].includes(record.mode)
      || !Number.isFinite(Date.parse(record.createdAt)) || !archive.isFile() || archive.size !== record.sizeBytes) throw new Error('External backup or recovery record is incomplete');
    return record;
  }
  async list(runtimeUuid: string) {
    let dir: string;
    try { dir = await this.directory(runtimeUuid); }
    catch (e: any) { if (e.code === 'ENOENT') { await this.verifyRoot(this.root); return []; } throw e; }
    const names = await fs.readdir(dir);
    if (names.length > 2000) throw new Error('External backup inventory is too large');
    const records: ExternalBackupRecord[] = [];
    for (const name of names) {
      // Interrupted transfers and unrelated data are never published or pruned.
      if (!name.startsWith('native-') || !name.endsWith('.tar.gz')) continue;
      try { records.push(await this.read(dir, name)); }
      catch (error: any) {
        // Malformed or incomplete copies remain for inspection; a storage I/O
        // failure must not masquerade as a successful empty inventory.
        if (error.code && error.code !== 'ENOENT') throw error;
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }
  async publish(input: { runtimeUuid: string; name: string; archive: string; mode: 'live' | 'offline'; server: Record<string, unknown>; keep: number | null }) {
    const name = safeName(input.name);
    if (input.keep !== null && (!Number.isSafeInteger(input.keep) || input.keep < 1 || input.keep > 100)) throw new Error('Invalid external retention count');
    const dir = await this.directory(input.runtimeUuid, true);
    const target = path.join(dir, name);
    if (await fs.lstat(target).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) throw new Error('An external backup with this name already exists');
    const staging = path.join(dir, '.partial-' + randomUUID());
    await fs.mkdir(staging, { mode: 0o700 });
    try {
      const checked = await copyChecked(input.archive, path.join(staging, 'archive.tar.gz'));
      const record: ExternalBackupRecord = { schema: 1, runtimeUuid: input.runtimeUuid, name, ...checked,
        createdAt: new Date().toISOString(), mode: input.mode, server: input.server };
      const file = await fs.open(path.join(staging, 'recovery.json'), 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
      await syncDirectory(staging);
      await this.verifyRoot(this.root);
      await fs.rename(staging, target);
      await syncDirectory(dir);
      let removed = 0;
      if (input.keep !== null) {
        const records = await this.list(input.runtimeUuid);
        // Always protect the archive just verified, even with a clock correction.
        const older = records.filter(r => r.name !== name).slice(input.keep - 1);
        for (const old of older) {
          await this.read(dir, old.name);
          await fs.rm(path.join(dir, old.name), { recursive: true }); removed++;
        }
        await syncDirectory(dir);
      }
      return { name, ...checked, removed };
    } finally { await fs.rm(staging, { recursive: true, force: true }).catch(() => {}); }
  }
  async importArchive(runtimeUuid: string, name: string, localDirectory: string) {
    const dir = await this.directory(runtimeUuid);
    const record = await this.read(dir, name);
    await realDirectory(localDirectory);
    const target = path.join(localDirectory, safeName(name));
    const staging = path.join(localDirectory, '.external-' + randomUUID() + '.partial');
    try {
      await copyChecked(path.join(dir, name, 'archive.tar.gz'), staging, record.sha256);
      await validateNativeArchive(staging);
      // Atomic no-clobber publication: never replace an existing local archive.
      await fs.link(staging, target);
      await syncDirectory(localDirectory);
      return { name, mode: record.mode };
    } finally { await fs.unlink(staging).catch(() => {}); }
  }
}
