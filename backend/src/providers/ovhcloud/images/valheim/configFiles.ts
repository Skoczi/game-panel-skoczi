import type { ConfigFileDescriptor } from '../../settings/types.js';

export function valheimConfigFiles(): ConfigFileDescriptor[] {
    return [
        { path: '/save/adminlist.txt', format: 'txt', label: 'Admins' },
        { path: '/save/permittedlist.txt', format: 'txt', label: 'Allowed players (whitelist)' },
        { path: '/save/bannedlist.txt', format: 'txt', label: 'Banned players' },
    ];
}
