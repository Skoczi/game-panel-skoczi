import type { GameServerRow } from '../../../../types/gameServer.js';
import { parseStoredEnv } from '../../../runtimeConfig.js';
import { VALHEIM_WORLDS_API_PATH } from './backups.js';

const DEFAULT_WORLD_NAME = 'Dedicated';
const VALHEIM_CACHE_API_PATH = '/save/cache';

function resolveWorldName(server: GameServerRow): string {
    const prefix = 'VALHEIM_WORLD_NAME=';
    let value = DEFAULT_WORLD_NAME;
    for (const entry of parseStoredEnv(server)) {
        if (entry.startsWith(prefix)) value = entry.slice(prefix.length);
    }
    return value.trim() || DEFAULT_WORLD_NAME;
}

export function resolveValheimSoftWipeTargets(server: GameServerRow): string[] {
    const world = resolveWorldName(server);
    return [
        `${VALHEIM_WORLDS_API_PATH}/${world}`,
        `${VALHEIM_CACHE_API_PATH}/${world}_biomedatacache.bin`,
    ];
}
