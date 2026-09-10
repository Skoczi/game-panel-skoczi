import type { ConfigFileDescriptor } from '../../settings/types.js';

export function hytaleConfigFiles(): ConfigFileDescriptor[] {
    return [
        { path: '/game/Server/config.json', format: 'json', label: 'Server configuration' },
    ];
}
