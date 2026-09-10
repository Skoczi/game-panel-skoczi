import type { GameServerRow } from '../../../../types/gameServer.js';
import type {
    EnvMap,
    LaunchSettingsAccessor,
    SettingDefinition,
    SettingValue,
} from '../../settings/types.js';
import { assertOvhcloudPalworldServer } from '../palworld.js';

const ADMIN_PASSWORD_ENV = 'PALWORLD_ADMIN_PASSWORD';
const UPDATE_ON_START_ENV = 'PALWORLD_UPDATE_ON_START';

const PALWORLD_LAUNCH_DEFINITIONS: SettingDefinition[] = [
    {
        key: 'adminPassword',
        group: 'security',
        type: 'string',
        label: 'Admin password',
        description: "Used for in-game admin actions and the server's REST API.",
        secret: true,
        default: '',
        pattern: '^[^"]*$',
        patternMessage: 'Double quotes are not allowed in this value.',
    },
    {
        key: 'updateOnStart',
        group: 'updates',
        type: 'boolean',
        label: 'Update on start',
        description: 'When enabled, the server checks for and installs game updates via SteamCMD each time it starts.',
        default: false,
    },
];

const PALWORLD_LAUNCH_SETTINGS: LaunchSettingsAccessor = {
    definitions(server: GameServerRow): SettingDefinition[] {
        assertOvhcloudPalworldServer(server);
        return PALWORLD_LAUNCH_DEFINITIONS;
    },

    read(_server: GameServerRow, env: EnvMap): Map<string, SettingValue> {
        return new Map<string, SettingValue>([
            ['adminPassword', env.get(ADMIN_PASSWORD_ENV) ?? ''],
            ['updateOnStart', (env.get(UPDATE_ON_START_ENV) ?? 'false') === 'true'],
        ]);
    },

    apply(_server: GameServerRow, env: EnvMap, updates: Map<string, SettingValue>): EnvMap {
        for (const [key, value] of updates) {
            if (key === 'adminPassword') env.set(ADMIN_PASSWORD_ENV, String(value));
            if (key === 'updateOnStart') env.set(UPDATE_ON_START_ENV, value ? 'true' : 'false');
        }

        return env;
    },
};

export function palworldLaunchSettingsAccessor(): LaunchSettingsAccessor {
    return PALWORLD_LAUNCH_SETTINGS;
}
