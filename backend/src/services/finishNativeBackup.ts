import type { GameServerRow } from '../types/gameServer.js';
import type { NativeBackupPolicy } from './nativeBackupPolicy.js';
import { copyBackupExternally } from './externalBackups.js';
import { planNativeRetention, applyNativeRetention } from './nativeRetention.js';
import { getServerStoragePaths } from '../utils/storage.js';
import path from 'node:path';

export async function finishNativeBackup(server: GameServerRow, archive: string, live: boolean, policy: NativeBackupPolicy) {
  const messages: string[] = [];
  if (policy.externalCopy) {
    try {
      const copy = await copyBackupExternally(server, archive, live, policy.automaticRetention ? policy.keepExternal : null);
      messages.push(`External copy verified (SHA-256); ${copy.removed} old external backup(s) removed.`);
    } catch (error) {
      throw new Error(`Local backup is ready. External copy or its retention failed; local retention was not run. ${error instanceof Error ? error.message : 'Check external storage.'}`);
    }
  }
  if (policy.automaticRetention) {
    const dataDir = getServerStoragePaths(server.id).dataDir;
    const retention = { keepArchives: policy.keepLocal, keepRecovery: 100 };
    const current = path.basename(archive);
    const plan = await planNativeRetention(dataDir, retention, true, current);
    const result = await applyNativeRetention(dataDir, retention, plan.fingerprint, true, current);
    messages.push(`Automatic retention removed ${result.removed.length} old local backup(s).`);
  }
  return messages.join(' ');
}
