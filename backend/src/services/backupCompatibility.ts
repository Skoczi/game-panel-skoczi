import { runtimeCapabilities } from '../utils/runtimeCapabilities.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getServerStoragePaths } from '../utils/storage.js';
import { nativeServerTemplate } from './nativeBackups.js';
import type { GameServerRow } from '../types/gameServer.js';
export async function backupCompatibility(server: GameServerRow) {
  if (!nativeServerTemplate(server))
    return { capabilities: runtimeCapabilities, native: false, layoutReady: true, legacy: [], recoveryCount: 0 };
  const root = getServerStoragePaths(server.id).serverRoot;
  const source = await fs.lstat(path.join(root, 'data/serverfiles')).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const legacyDir = path.join(root, '.native-backups');
  const legacyStat = await fs.lstat(legacyDir).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const names = legacyStat?.isDirectory() ? await fs.readdir(legacyDir) : [];
  const legacy = [];
  for (const name of names) {
    const st = await fs.lstat(path.join(legacyDir, name));
    if (st.isFile() && name.endsWith('.tar.gz'))
      legacy.push({ name, size: st.size, modifiedAt: st.mtime.toISOString() });
  }
  const backupDir = path.join(root, 'data/backups');
  const stat = await fs.lstat(backupDir).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const recoveryCount = stat?.isDirectory()
    ? (await fs.readdir(backupDir)).filter((name) => name.startsWith('recovery-')).length
    : 0;
  return { capabilities: runtimeCapabilities, native: true, layoutReady: Boolean(source?.isDirectory()), legacy, recoveryCount };
}
export async function legacyBackupPath(server: GameServerRow, name: string) {
  const status = await backupCompatibility(server);
  if (!status.legacy.some((entry) => entry.name === name) || path.basename(name) !== name)
    throw Object.assign(new Error('Legacy archive not found'), { statusCode: 404 });
  return path.join(getServerStoragePaths(server.id).serverRoot, '.native-backups', name);
}
