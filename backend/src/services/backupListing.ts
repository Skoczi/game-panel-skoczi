import { getServerOrThrow } from './servers.js';
import { listServerFiles } from './fileExplorer.js';
import { getBackupKind, getBackupFileLocation, listBackupDirectories, getBackupFilePair, getSupportedBackupExtensions } from './serverBackups.js';

export async function listServerBackups(serverId: number) {
    const server = await getServerOrThrow(serverId);
    const kind = getBackupKind(server);
    const location = await getBackupFileLocation(server);

    let result;
    try {
        result = await listServerFiles({
            serverId,
            path: location.basePath.replace(/\/+$/, '') || '/',
            root: location.root,
        });
    } catch (error: any) {
        if (server.provider === 'ovhcloud' && error?.statusCode === 404) {
            return {
                root: location.root,
                path: '/',
                entries: [],
                roots: [],
            };
        }
        throw error;
    }

    if (kind === 'directory') {
        result.entries = listBackupDirectories(server, result.entries);
    } else if (kind === 'file-pair') {
        result.entries = getBackupFilePair(server).listBackups(result.entries);
    } else {
        const extensions = getSupportedBackupExtensions(server);
        result.entries = result.entries.filter((e: any) => (
            e.type === 'file' && extensions.some((extension) => e.name.endsWith(extension))
        ));
    }
    result.path = '/';

    return result;
}
