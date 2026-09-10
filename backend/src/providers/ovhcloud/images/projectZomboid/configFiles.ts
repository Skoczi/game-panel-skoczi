import type { GameServerRow } from '../../../../types/gameServer.js';
import type { ConfigFileDescriptor } from '../../settings/types.js';
import { iniFilePath, resolveServerName, sandboxFilePath } from './settings.js';

export function projectZomboidConfigFiles(server: GameServerRow): ConfigFileDescriptor[] {
    const serverName = resolveServerName(server);

    return [
        { path: iniFilePath(serverName), format: 'ini', label: 'Server options' },
        { path: sandboxFilePath(serverName), format: 'lua', label: 'World / sandbox options' },
        { path: `/zomboid/Server/${serverName}_spawnpoints.lua`, format: 'lua', label: 'Spawn points' },
        { path: `/zomboid/Server/${serverName}_spawnregions.lua`, format: 'lua', label: 'Spawn regions' },
    ];
}
