import { getDatabase } from '../database/init.js';
import { userRepository } from '../database/index.js';
import { fleet, fleetPermissions } from '../fleet/control.js';
import { ApiTokenStore } from './apiTokens.js';
import { apiTokenManagement } from '../routes/apiTokenManagement.js';
import { publicApi } from '../routes/publicApi.js';
import { apiResources } from './publicApiResources.js';
import { apiBackups } from './publicApiBackups.js';
import { ApiOperationStore } from './apiOperations.js';
import { normalizeBackupName } from './nativeBackups.js';
import { startApiBackup, readApiBackupJob } from './publicApiBackupOperations.js';

let tokens: ApiTokenStore;
let operations: ApiOperationStore;
export async function initializePublicApi() {
    tokens = new ApiTokenStore(await getDatabase());
    await tokens.initialize();
    operations = new ApiOperationStore(await getDatabase());
    await operations.initialize();
}
export const apiTokenRoutes = apiTokenManagement({
    store: () => tokens,
    permissions: async (id, user) => {
        const row = await fleet().get(id);
        return row && !row.missing ? fleetPermissions(row, user) : null;
    },
});
export const publicApiRoutes = publicApi({
    store: () => tokens,
    owner: async id => {
        const user = await userRepository.findById(id);
        return user ? { userId: user.id, isRoot: Boolean(user.is_root), enabled: Boolean(user.is_enabled) } : null;
    },
    servers: () => fleet().list(),
    permissions: fleetPermissions,
    resources: apiResources,
    backups: apiBackups,
    operations: { store: () => operations, normalizeName: normalizeBackupName, start: startApiBackup, readJob: readApiBackupJob },
});
