import { runExternalBackupWorker } from './externalBackupProcess.js';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getServerStoragePaths } from '../utils/storage.js';
import { recordNativeBackup } from './nativeProtection.js';
import { validateNativeArchive } from './nativeArchive.js';
import type { GameServerRow } from '../types/gameServer.js';
import type { ExternalBackupRecord } from './externalBackupStore.js';

export function externalBackupDestination() {
  const root = process.env.GAMEPANEL_EXTERNAL_BACKUP_ROOT?.trim();
  return { configured: Boolean(root), label: root ? (process.env.GAMEPANEL_EXTERNAL_BACKUP_LABEL?.trim() || 'External storage').slice(0, 80) : null };
}
function request<T>(payload: Record<string, unknown>, timeout: number): Promise<T> {
  const root = process.env.GAMEPANEL_EXTERNAL_BACKUP_ROOT?.trim();
  if (!root) throw Object.assign(new Error('External backup storage has not been configured on this node'), { statusCode: 409 });
  return runExternalBackupWorker<T>(fileURLToPath(new URL('./externalBackupWorker.js', import.meta.url)), { ...payload, root }, timeout);
}
export function listExternalBackups(server: GameServerRow) {
  return request<Array<Omit<ExternalBackupRecord, 'server'>>>({ action: 'list', runtimeUuid: server.runtime_uuid }, 15_000);
}
export function copyBackupExternally(server: GameServerRow, archive: string, live: boolean, keep: number | null) {
  return request<{ name: string; sha256: string; sizeBytes: number; removed: number }>({ action: 'publish', input: {
    runtimeUuid: server.runtime_uuid, name: path.basename(archive), archive, mode: live ? 'live' : 'offline', keep,
    server: { id: server.id, runtimeUuid: server.runtime_uuid, name: server.name, provider: server.provider,
      dockerImage: server.docker_image, dockerImageDigest: server.docker_image_digest,
      ports: JSON.parse(server.ports_json), mounts: JSON.parse(server.mounts_json),
      environment: JSON.parse(server.env_json), resources: JSON.parse(server.resource_limits_json || '{}'),
      providerMetadata: JSON.parse(server.provider_metadata_json || '{}'), runtimeConfig: JSON.parse(server.runtime_config_json || '{}') },
  } }, 600_000);
}
export async function importExternalBackup(server: GameServerRow, name: string) {
  const dir = path.join(getServerStoragePaths(server.id).dataDir, 'backups');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const result = await request<{ name: string; mode: 'live' | 'offline' }>({ action: 'import', runtimeUuid: server.runtime_uuid, name, localDirectory: dir }, 600_000);
  const archive = path.join(dir, result.name);
  // Import never restores the game automatically. It becomes an ordinary local
  // archive only after the same structure check used for new backups.
  await validateNativeArchive(archive);
  await recordNativeBackup(archive, result.mode === 'live');
  return { ok: true, exitCode: 0, stdout: `External backup imported and checked: ${result.name}`, stderr: '' };
}
