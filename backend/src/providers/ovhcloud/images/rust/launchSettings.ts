import type { GameServerRow } from '../../../../types/gameServer.js';
import {
    getPooledParam,
    parsePooledParams,
    serializePooledParams,
    setPooledParam,
} from '../../settings/pooledParams.js';
import type {
    EnvMap,
    LaunchSettingsAccessor,
    SettingDefinition,
    SettingValue,
} from '../../settings/types.js';
import { LAUNCH_TOKEN_MESSAGE, LAUNCH_TOKEN_PATTERN } from '../../settings/values.js';
import { assertOvhcloudRustServer } from '../rust.js';

const START_PARAMS_ENV = 'RUST_START_PARAMS';
const RCON_PASSWORD_ENV = 'RUST_RCON_PASSWORD';
const UPDATE_ON_START_ENV = 'RUST_UPDATE_ON_START';

const RUST_LAUNCH_DEFINITIONS: SettingDefinition[] = [
    {
        key: 'server.worldsize',
        group: 'world',
        type: 'integer',
        label: 'World size',
        description: 'Map size in metres. Only applies to the first map generation — changing it later requires a wipe. Leave empty for the game default (4000).',
        min: 1000,
        max: 6000,
        nullable: true,
        default: '',
    },
    {
        key: 'server.seed',
        group: 'world',
        type: 'integer',
        label: 'World seed',
        description: 'Seed used to generate the map. Only applies to the first map generation — changing it later requires a wipe. Leave empty for a random seed.',
        min: 0,
        max: 2147483647,
        nullable: true,
        default: '',
    },
    {
        key: 'server.gamemode',
        group: 'gameplay',
        type: 'select',
        label: 'Game mode',
        description: 'Changing the game mode resets all players and their inventories.',
        options: [
            { value: '', label: 'Default (survival)' },
            { value: 'softcore', label: 'Softcore' },
            { value: 'hardcore', label: 'Hardcore' },
            { value: 'primitive', label: 'Primitive' },
        ],
        default: '',
        pattern: LAUNCH_TOKEN_PATTERN,
        patternMessage: LAUNCH_TOKEN_MESSAGE,
    },
    {
        key: 'rconPassword',
        group: 'security',
        type: 'string',
        label: 'RCON password',
        description: 'Password the panel and external tools use to reach the server console.',
        secret: true,
        minLength: 8,
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

const POOLED_CONVARS = ['server.worldsize', 'server.seed', 'server.gamemode'];

const RUST_LAUNCH_SETTINGS: LaunchSettingsAccessor = {
    definitions(server: GameServerRow): SettingDefinition[] {
        assertOvhcloudRustServer(server);
        return RUST_LAUNCH_DEFINITIONS;
    },

    read(_server: GameServerRow, env: EnvMap): Map<string, SettingValue> {
        const tokens = parsePooledParams(env.get(START_PARAMS_ENV) ?? '');
        const values = new Map<string, SettingValue>();

        for (const convar of POOLED_CONVARS) {
            const raw = getPooledParam(tokens, convar);
            if (raw === null) continue;

            if (convar === 'server.gamemode') {
                values.set(convar, raw);
                continue;
            }

            const numeric = Number(raw);
            values.set(convar, Number.isInteger(numeric) ? numeric : '');
        }

        values.set('rconPassword', env.get(RCON_PASSWORD_ENV) ?? '');
        values.set('updateOnStart', (env.get(UPDATE_ON_START_ENV) ?? 'false') === 'true');

        return values;
    },

    apply(_server: GameServerRow, env: EnvMap, updates: Map<string, SettingValue>): EnvMap {
        let tokens = parsePooledParams(env.get(START_PARAMS_ENV) ?? '');

        for (const [key, value] of updates) {
            if (key === 'rconPassword') {
                env.set(RCON_PASSWORD_ENV, String(value));
                continue;
            }

            if (key === 'updateOnStart') {
                env.set(UPDATE_ON_START_ENV, value ? 'true' : 'false');
                continue;
            }

            tokens = setPooledParam(tokens, key, String(value));
        }

        const startParams = serializePooledParams(tokens);
        if (startParams) env.set(START_PARAMS_ENV, startParams);
        else env.delete(START_PARAMS_ENV);

        return env;
    },
};

export function rustLaunchSettingsAccessor(): LaunchSettingsAccessor {
    return RUST_LAUNCH_SETTINGS;
}
