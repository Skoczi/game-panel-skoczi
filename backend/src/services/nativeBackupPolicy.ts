import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getServerStoragePaths } from '../utils/storage.js';
import { syncDirectory } from './nativeRestoreJournal.js';

export interface NativeBackupPolicy {
  revision: number;
  automaticRetention: boolean;
  keepLocal: number;
  externalCopy: boolean;
  keepExternal: number;
}
export const defaultBackupPolicy: NativeBackupPolicy = {
  revision: 0, automaticRetention: false, keepLocal: 7, externalCopy: false, keepExternal: 14,
};
export function validateBackupPolicy(value: unknown): NativeBackupPolicy {
  const p = value as NativeBackupPolicy;
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).some(k => !Object.keys(defaultBackupPolicy).includes(k))
    || !Number.isSafeInteger(p.revision) || p.revision < 0
    || typeof p.automaticRetention !== 'boolean' || typeof p.externalCopy !== 'boolean'
    || ![p.keepLocal, p.keepExternal].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 100)) {
    throw Object.assign(new Error('Choose between 1 and 100 local and external backups to keep.'), { statusCode: 400 });
  }
  return { revision: p.revision, automaticRetention: p.automaticRetention, keepLocal: p.keepLocal,
    externalCopy: p.externalCopy, keepExternal: p.keepExternal };
}
const filename = (id: number) => path.join(getServerStoragePaths(id).serverRoot, '.backup-policy.json');
export async function readNativeBackupPolicy(id: number): Promise<NativeBackupPolicy> {
  try {
    const stat = await fs.lstat(filename(id));
    if (!stat.isFile() || stat.size > 4096) throw new Error('Invalid backup policy file');
    return validateBackupPolicy(JSON.parse(await fs.readFile(filename(id), 'utf8')));
  } catch (error: any) {
    if (error.code === 'ENOENT') return { ...defaultBackupPolicy };
    throw new Error('Backup settings could not be read. Repair them before creating a backup.');
  }
}
// Caller owns the same server mutation lock used by backups and restores.
export async function saveNativeBackupPolicy(id: number, input: unknown) {
  const policy = validateBackupPolicy(input);
  const previous = await readNativeBackupPolicy(id);
  if (policy.revision !== previous.revision) throw Object.assign(new Error('Backup settings changed. Reload before saving.'), { statusCode: 409 });
  const next = { ...policy, revision: policy.revision + 1 };
  const target = filename(id), temporary = target + '.' + randomUUID() + '.tmp';
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(next)); await file.sync(); } finally { await file.close(); }
    await fs.rename(temporary, target);
    await syncDirectory(path.dirname(target));
    return next;
  } finally { await fs.unlink(temporary).catch(() => {}); }
}
