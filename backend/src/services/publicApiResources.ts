import { resourceDto } from './apiResourceDto.js';
import { readApiRuntime } from './apiRuntimeTransport.js';
import type { FleetRow } from '../fleet/store.js';
import { getServerResourceSnapshot } from '../utils/serverMetricsCache.js';
export async function apiResources(row: FleetRow, actorId: number) {
    return resourceDto(row.node_id === 'local' ? getServerResourceSnapshot(row.runtime_id)
        : await readApiRuntime(row, actorId, 'resources', []));
}
