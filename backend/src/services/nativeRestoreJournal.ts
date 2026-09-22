import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getServerStoragePaths } from '../utils/storage.js';
import { blockNativeServer, unblockNativeServer } from './nativeOperationLock.js';

export type RestoreJournal = { recovery: string; staging: string; keys?: string[] };
const journalPath = (id: number) =>
  path.join(getServerStoragePaths(id).serverRoot, '.native-restore.json');
export async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function beginRestoreJournal(id: number, journal: RestoreJournal) {
  const filename = journalPath(id);
  const handle = await fs.open(filename, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(journal));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filename));
}
export async function finishRestoreJournal(id: number) {
  await fs.unlink(journalPath(id));
  await syncDirectory(path.dirname(journalPath(id)));
  unblockNativeServer(id);
}
export async function hasRestoreJournal(id: number) {
  return fs.lstat(journalPath(id)).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
}
// An unfinished transaction always rolls back to the previous complete tree.
export async function rollbackInterruptedRestore(id: number) {
  blockNativeServer(
    id,
    'Native restore was interrupted. Recovery must finish before changing this server.'
  );
  const journal: RestoreJournal = JSON.parse(await fs.readFile(journalPath(id), 'utf8'));
  if (
    !/^recovery-[0-9a-f-]+$/.test(journal.recovery) ||
    !/^\.restore-[a-zA-Z0-9]+$/.test(journal.staging)
  )
    throw new Error('Invalid restore recovery journal');
  const data = path.join(getServerStoragePaths(id).serverRoot, 'data');
  const backups = path.join(data, 'backups');
  const keys = journal.keys ?? ['serverfiles'];
  if (!Array.isArray(keys) || !keys.includes('serverfiles') || keys.some(k => !['serverfiles','fastdownload'].includes(k)) || new Set(keys).size !== keys.length) throw new Error('Invalid restore mount list');
  for (const key of keys) {
  const previous = path.join(backups, journal.recovery, key);
  const current = path.join(data, key);
  const old = await fs.lstat(previous).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (old) {
    if (!old.isDirectory()) throw new Error('Recovery tree is not a directory');
    const existing = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing)
      await fs.rename(current, path.join(backups, journal.recovery, `interrupted-${key}-${Date.now()}`));
    await fs.rename(previous, current);
  } else if (!(await fs.lstat(current)).isDirectory())
    throw new Error('Original game files are missing');
  }
  await syncDirectory(data);
  await syncDirectory(path.join(backups, journal.recovery));
  await finishRestoreJournal(id);
  // Retain staged/interrupted data for inspection; never discard the only candidate tree.
}
