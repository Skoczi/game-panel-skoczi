import type { FleetRow } from '../fleet/store.js';
import { listServerBackups } from './backupListing.js';
import { readApiRuntime } from './apiRuntimeTransport.js';
import { backupDtos } from './apiBackupDto.js';
export async function apiBackups(row: FleetRow, actorId: number) {
    return backupDtos(row.node_id === 'local' ? await listServerBackups(row.runtime_id)
        : await readApiRuntime(row, actorId, 'backups', ['backups.read'], 1024 * 1024));
}
