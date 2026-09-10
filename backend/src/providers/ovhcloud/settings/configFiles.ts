import { promises as fs } from 'node:fs';
import type { GameServerRow } from '../../../types/gameServer.js';
import { resolveServerPath } from '../../../services/fileExplorer.js';
import type { ConfigFileDescriptor, ConfigFileEntry, OvhcloudSettingsSupport } from './types.js';

async function fileExists(serverId: number, descriptor: ConfigFileDescriptor): Promise<boolean> {
    try {
        const resolved = await resolveServerPath({
            serverId,
            root: descriptor.root ?? 'data',
            path: descriptor.path,
        });
        const stats = await fs.stat(resolved.absPath);
        return stats.isFile();
    } catch {
        return false;
    }
}

export async function listConfigFiles(
    server: GameServerRow,
    support: OvhcloudSettingsSupport
): Promise<ConfigFileEntry[]> {
    if (!support.configFiles) return [];

    const descriptors = await support.configFiles(server);

    return Promise.all(
        descriptors.map(async (descriptor) => ({
            path: descriptor.path,
            root: descriptor.root ?? 'data',
            format: descriptor.format,
            label: descriptor.label,
            exists: await fileExists(server.id, descriptor),
        }))
    );
}
