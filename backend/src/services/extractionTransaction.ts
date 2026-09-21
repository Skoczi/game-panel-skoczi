import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getServerStoragePaths } from '../utils/storage.js';
import { ensureResolvedPathInsideRoot } from '../utils/fsBrowser.js';
import { syncDirectory } from './nativeRestoreJournal.js';
import { blockNativeServer, unblockNativeServer } from './nativeOperationLock.js';

type Journal = {
  workspace: string;
  destination: string;
  files: Array<{ name: string; existed: boolean }>;
};
const marker = (root: string) => path.join(root, '.extract-transaction.json');
async function syncParents(directory: string, root: string) {
  for (let current = directory; ; current = path.dirname(current)) {
    await syncDirectory(current);
    if (path.resolve(current) === path.resolve(root)) return;
    if (!path.resolve(current).startsWith(path.resolve(root) + path.sep))
      throw new Error('Invalid transaction directory');
  }
}
async function checkParent(filename: string, root: string) {
  if (
    !path.resolve(filename).startsWith(path.resolve(root) + path.sep) &&
    path.resolve(filename) !== path.resolve(root)
  )
    throw new Error('Extraction path escapes server root');
  const existing = await stat(filename);
  if (!existing) return checkParent(path.dirname(filename), root);
  if (!existing.isDirectory()) throw new Error('Extraction parent is not a real directory');
  await ensureResolvedPathInsideRoot(filename, root);
  if (path.resolve(filename) !== path.resolve(root))
    await checkParent(path.dirname(filename), root);
}
async function stat(filename: string) {
  return fs.lstat(filename).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}
async function save(root: string, journal: Journal) {
  const file = await fs.open(marker(root), 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(journal));
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDirectory(root);
}
export async function hasExtractionTransaction(serverId: number) {
  return Boolean(await stat(marker(getServerStoragePaths(serverId).serverRoot)));
}
export async function recoverExtraction(serverId: number) {
  const root = getServerStoragePaths(serverId).serverRoot;
  if (!(await stat(marker(root)))) return;
  blockNativeServer(serverId, 'Interrupted archive extraction requires recovery');
  const journal: Journal = JSON.parse(await fs.readFile(marker(root), 'utf8'));
  if (!/^\.extract-[0-9a-f-]+$/.test(journal.workspace))
    throw new Error('Invalid extraction recovery workspace');
  const destination = path.resolve(root, journal.destination);
  if (!destination.startsWith(path.resolve(root) + path.sep))
    throw new Error('Invalid extraction recovery destination');
  const workspace = path.join(root, journal.workspace);
  for (const entry of [...journal.files].reverse()) {
    if (
      !entry.name ||
      entry.name.split('/').some((part) => !part || part === '..' || part === '.') ||
      entry.name.includes('\\')
    )
      throw new Error('Invalid extraction recovery entry');
    const target = path.join(destination, entry.name),
      old = path.join(workspace, 'old', entry.name),
      staged = path.join(workspace, 'new', entry.name);
    await checkParent(path.dirname(target), root);
    if (await stat(old)) {
      await fs.rm(target, { force: true });
      await fs.rename(old, target);
      await syncDirectory(path.dirname(target));
    } else if (!entry.existed && !(await stat(staged))) {
      await fs.rm(target, { force: true });
      await syncDirectory(path.dirname(target));
    }
  }
  await fs.unlink(marker(root));
  await syncDirectory(root);
  unblockNativeServer(serverId);
  await fs.rm(workspace, { recursive: true, force: true });
}
export async function commitExtractedTree(
  serverId: number,
  staging: string,
  destination: string,
  overwrite: boolean
) {
  const root = getServerStoragePaths(serverId).serverRoot;
  const workspace = `.extract-${randomUUID()}`;
  const directory = path.join(root, workspace);
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.rename(staging, path.join(directory, 'new'));
  const files: Journal['files'] = [];
  const directories: string[] = [];
  let journalWritten = false;
  try {
    async function collect(relative: string) {
      const source = path.join(directory, 'new', relative);
      const sourceStat = await fs.lstat(source);
      const target = path.join(destination, relative);
      await checkParent(path.dirname(target), root);
      const existing = await stat(target);
      if (sourceStat.isDirectory()) {
        if (existing && !existing.isDirectory())
          throw new Error('Archive directory conflicts with an existing file');
        directories.push(relative);
        for (const child of await fs.readdir(source)) await collect(path.join(relative, child));
      } else {
        if (!sourceStat.isFile() || (existing && !existing.isFile()))
          throw new Error('Archive conflicts with a link or special file');
        if (existing && !overwrite) throw new Error(`File already exists: ${relative}`);
        const handle = await fs.open(source, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        files.push({ name: relative, existed: Boolean(existing) });
      }
    }
    for (const child of await fs.readdir(path.join(directory, 'new'))) await collect(child);
    for (const relative of directories) {
      const target = path.join(destination, relative);
      if (!(await stat(target))) {
        const metadata = await fs.stat(path.join(directory, 'new', relative));
        await fs.mkdir(target, { recursive: true, mode: metadata.mode & 0o777 });
        if (process.getuid?.() === 0) await fs.chown(target, metadata.uid, metadata.gid);
      }
    }
    await save(root, { workspace, destination: path.relative(root, destination), files });
    journalWritten = true;
    for (const entry of files) {
      const target = path.join(destination, entry.name),
        old = path.join(directory, 'old', entry.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (entry.existed) {
        await fs.mkdir(path.dirname(old), { recursive: true });
        await fs.rename(target, old);
        await syncParents(path.dirname(old), root);
        await syncDirectory(path.dirname(target));
      }
      await fs.rename(path.join(directory, 'new', entry.name), target);
      await syncDirectory(path.dirname(path.join(directory, 'new', entry.name)));
      await syncDirectory(path.dirname(target));
    }
    await fs.unlink(marker(root));
    await syncDirectory(root);
    journalWritten = false;
    await fs.rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (journalWritten) {
      try {
        await recoverExtraction(serverId);
      } catch (recoveryError) {
        blockNativeServer(
          serverId,
          'Archive recovery failed. Restart the agent to recover before changing this server.'
        );
        throw recoveryError;
      }
    } else await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
