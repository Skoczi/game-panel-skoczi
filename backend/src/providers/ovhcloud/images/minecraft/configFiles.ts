import type { ConfigFileDescriptor } from '../../settings/types.js';

export function minecraftConfigFiles(): ConfigFileDescriptor[] {
    return [
        { path: '/server.properties', format: 'properties', label: 'Server properties' },
    ];
}
