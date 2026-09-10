import type { ConfigFileDescriptor } from '../../settings/types.js';

export function counterStrike2ConfigFiles(): ConfigFileDescriptor[] {
    return [
        { path: '/server/game/csgo/cfg/server.cfg', format: 'cfg', label: 'Server convars (server.cfg)' },
    ];
}
