import type { GameServerRow } from '../../../../types/gameServer.js';
import type {
    EnvMap,
    LaunchSettingsAccessor,
    SettingDefinition,
    SettingValue,
} from '../../settings/types.js';
import { assertOvhcloudProjectZomboidServer } from '../projectZomboid.js';

const ADMIN_PASSWORD_ENV = 'PZ_ADMIN_PASSWORD';
const UPDATE_ON_START_ENV = 'PZ_UPDATE_ON_START';

const PROJECT_ZOMBOID_LAUNCH_DEFINITIONS: SettingDefinition[] = [
    {
        key: 'adminPassword',
        group: 'security',
        type: 'string',
        label: 'Admin password',
        description: 'In-game admin account password (used to run privileged console commands). This is not the server join password. The server refuses to start without it.',
        secret: true,
        minLength: 1,
        default: '',
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

const PROJECT_ZOMBOID_LAUNCH_SETTINGS: LaunchSettingsAccessor = {
    definitions(server: GameServerRow): SettingDefinition[] {
        assertOvhcloudProjectZomboidServer(server);
        return PROJECT_ZOMBOID_LAUNCH_DEFINITIONS;
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

export function projectZomboidLaunchSettingsAccessor(): LaunchSettingsAccessor {
    return PROJECT_ZOMBOID_LAUNCH_SETTINGS;
}
