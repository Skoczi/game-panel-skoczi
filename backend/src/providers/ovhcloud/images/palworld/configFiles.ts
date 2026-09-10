import type { ConfigFileDescriptor } from '../../settings/types.js';

export function palworldConfigFiles(): ConfigFileDescriptor[] {
    return [
        {
            path: '/server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
            format: 'ini',
            label: 'World settings',
        },
        {
            path: '/server/DefaultPalWorldSettings.ini',
            format: 'ini',
            label: 'Default world settings (reference)',
        },
    ];
}
