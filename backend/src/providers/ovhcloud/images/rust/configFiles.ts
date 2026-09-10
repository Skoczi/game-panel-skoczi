import type { GameServerRow } from '../../../../types/gameServer.js';
import type { ConfigFileDescriptor } from '../../settings/types.js';
import { resolveRustIdentity } from '../rust.js';

export function rustConfigFiles(server: GameServerRow): ConfigFileDescriptor[] {
    const base = `/server/server/${resolveRustIdentity(server)}/cfg`;

    return [
        { path: `${base}/server.cfg`, format: 'cfg', label: 'Server convars (server.cfg)' },
        { path: `${base}/users.cfg`, format: 'cfg', label: 'Owners & moderators (users.cfg)' },
    ];
}
