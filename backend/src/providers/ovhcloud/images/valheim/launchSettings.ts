import type { GameServerRow } from '../../../../types/gameServer.js';
import type {
    EnvMap,
    LaunchSettingsAccessor,
    SettingDefinition,
    SettingOption,
    SettingValue,
} from '../../settings/types.js';
import { LAUNCH_TOKEN_MESSAGE, LAUNCH_TOKEN_PATTERN } from '../../settings/values.js';
import { assertOvhcloudValheimServer } from '../valheim.js';

const SERVER_NAME_ENV = 'VALHEIM_SERVER_NAME';
const SERVER_PASSWORD_ENV = 'VALHEIM_SERVER_PASSWORD';
const PUBLIC_ENV = 'VALHEIM_PUBLIC';
const UPDATE_ON_START_ENV = 'VALHEIM_UPDATE_ON_START';
const START_PARAMS_ENV = 'VALHEIM_START_PARAMS';

const VALUE_FLAGS: Record<string, string> = {
    preset: '-preset',
    saveinterval: '-saveinterval',
    backups: '-backups',
    backupshort: '-backupshort',
    backuplong: '-backuplong',
};

const BARE_FLAGS: Record<string, string> = {
    crossplay: '-crossplay',
};

const MODIFIER_KEYS = ['combat', 'deathpenalty', 'resources', 'raids', 'portals'] as const;

const SETKEY_NAMES = [
    'nomap',
    'noportals',
    'nobossportals',
    'nobuildcost',
    'noworkbench',
    'passivemobs',
    'playerevents',
    'teleportall',
] as const;

type ValheimParams = {
    values: Map<string, string>;
    modifiers: Map<string, string>;
    setkeys: Set<string>;
    flags: Set<string>;
    extra: string[];
};

const FLAG_TO_SETTING = new Map(Object.entries(VALUE_FLAGS).map(([key, flag]) => [flag, key]));
const BARE_FLAG_TO_SETTING = new Map(Object.entries(BARE_FLAGS).map(([key, flag]) => [flag, key]));

function isValue(word: string | undefined): word is string {
    return word !== undefined && !word.startsWith('-');
}

function parseValheimParams(raw: string): ValheimParams {
    const words = String(raw ?? '').split(/\s+/).filter(Boolean);
    const params: ValheimParams = {
        values: new Map(),
        modifiers: new Map(),
        setkeys: new Set(),
        flags: new Set(),
        extra: [],
    };

    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];

        const settingKey = FLAG_TO_SETTING.get(word);
        if (settingKey && isValue(words[i + 1])) {
            params.values.set(settingKey, words[i + 1]);
            i += 1;
            continue;
        }

        const flagKey = BARE_FLAG_TO_SETTING.get(word);
        if (flagKey) {
            params.flags.add(flagKey);
            continue;
        }

        if (word === '-modifier' && isValue(words[i + 1]) && isValue(words[i + 2])) {
            params.modifiers.set(words[i + 1], words[i + 2]);
            i += 2;
            continue;
        }

        if (word === '-setkey' && isValue(words[i + 1])) {
            params.setkeys.add(words[i + 1]);
            i += 1;
            continue;
        }

        params.extra.push(word);
    }

    return params;
}

function serializeValheimParams(params: ValheimParams): string {
    const words: string[] = [...params.extra];

    for (const [key, flag] of Object.entries(BARE_FLAGS)) {
        if (params.flags.has(key)) words.push(flag);
    }

    const preset = params.values.get('preset');
    if (preset) words.push('-preset', preset);

    for (const key of MODIFIER_KEYS) {
        const value = params.modifiers.get(key);
        if (value) words.push('-modifier', key, value);
    }

    for (const name of SETKEY_NAMES) {
        if (params.setkeys.has(name)) words.push('-setkey', name);
    }

    for (const [key, flag] of Object.entries(VALUE_FLAGS)) {
        if (key === 'preset') continue;
        const value = params.values.get(key);
        if (value) words.push(flag, value);
    }

    return words.join(' ');
}

const token = {
    pattern: LAUNCH_TOKEN_PATTERN,
    patternMessage: LAUNCH_TOKEN_MESSAGE,
} as const;

function modifierOptions(values: string[]): SettingOption[] {
    return [{ value: '', label: 'Default' }, ...values.map((value) => ({ value, label: value }))];
}

function modifier(
    key: (typeof MODIFIER_KEYS)[number],
    label: string,
    description: string,
    values: string[]
): SettingDefinition {
    return {
        key: `modifier.${key}`,
        group: 'gameplay',
        type: 'select',
        label,
        description,
        options: modifierOptions(values),
        default: '',
        ...token,
    };
}

function setkey(
    name: (typeof SETKEY_NAMES)[number],
    label: string,
    description: string
): SettingDefinition {
    return {
        key: `setkey.${name}`,
        group: 'gameplay',
        type: 'boolean',
        label,
        description,
        default: false,
    };
}

const VALHEIM_LAUNCH_DEFINITIONS: SettingDefinition[] = [
    {
        key: 'serverName',
        group: 'branding',
        type: 'string',
        label: 'Server name',
        description: 'Name shown in the community server list. It must not contain the server password, which the game refuses to start with.',
        default: 'Valheim server',
    },
    {
        key: 'public',
        group: 'network',
        type: 'boolean',
        label: 'List in the community browser',
        description: 'Show the server in the in-game community list. A listed server requires a password; an unlisted one is joined by IP.',
        default: true,
    },
    {
        key: 'crossplay',
        group: 'network',
        type: 'boolean',
        label: 'Crossplay',
        description: 'Carry the players through the PlayFab relay instead of Steam, so Xbox, PlayStation and Nintendo Switch players can join. The server then also announces a join code, which it writes in its logs at startup.',
        default: false,
    },
    {
        key: 'serverPassword',
        group: 'security',
        type: 'string',
        label: 'Server password',
        description: 'Password required to join, at least 5 characters. Required while the server is listed in the community browser; may be empty otherwise.',
        secret: true,
        minLength: 5,
        nullable: true,
        default: '',
    },

    {
        key: 'preset',
        group: 'gameplay',
        type: 'select',
        label: 'World modifier preset',
        description: 'Applies a whole set of world modifiers at once. The individual modifiers below refine it.',
        options: modifierOptions(['casual', 'easy', 'normal', 'hard', 'hardcore', 'immersive', 'hammer']),
        default: '',
        ...token,
    },
    modifier('combat', 'Combat difficulty', 'How hard creatures hit and how much damage they take.', ['veryeasy', 'easy', 'hard', 'veryhard']),
    modifier('deathpenalty', 'Death penalty', 'What is lost on death, from keeping everything to losing skills permanently.', ['casual', 'veryeasy', 'easy', 'hard', 'hardcore']),
    modifier('resources', 'Resource rate', 'How much resources gathering and creatures yield.', ['muchless', 'less', 'more', 'muchmore', 'most']),
    modifier('raids', 'Raids', 'How often base raid events are triggered.', ['none', 'muchless', 'less', 'more', 'muchmore']),
    modifier('portals', 'Portal restrictions', 'How restrictive portals are about the items they carry.', ['casual', 'hard', 'veryhard']),

    setkey('nomap', 'No map', 'Disable the map and the minimap entirely.'),
    setkey('noportals', 'No portals', 'Portals cannot be built or used.'),
    setkey('nobossportals', 'No boss portals', 'Portals cannot be used while a boss is active.'),
    setkey('nobuildcost', 'No building cost', 'Building no longer consumes resources.'),
    setkey('noworkbench', 'No crafting station requirement', 'Building no longer requires a nearby workbench.'),
    setkey('passivemobs', 'Passive creatures', 'Creatures do not attack unless they are provoked.'),
    setkey('playerevents', 'Player-based events', 'Events and raids are triggered based on each player instead of the world progression.'),
    setkey('teleportall', 'Teleport all items', 'All items can be carried through portals, including ores and metal.'),

    {
        key: 'saveinterval',
        group: 'performance',
        type: 'integer',
        label: 'Autosave interval (seconds)',
        description: 'Seconds between automatic world saves. Leave empty for the game default.',
        min: 60,
        max: 86400,
        nullable: true,
        default: '',
    },
    {
        key: 'backups',
        group: 'performance',
        type: 'integer',
        label: 'Automatic backups kept',
        description: 'How many automatic world backups the game keeps. These are the backups the panel lists. Leave empty for the game default.',
        min: 0,
        max: 20,
        nullable: true,
        default: '',
    },
    {
        key: 'backupshort',
        group: 'performance',
        type: 'integer',
        label: 'First backup interval (seconds)',
        description: 'Interval used for the first automatic backups after a start. Leave empty for the game default.',
        min: 60,
        max: 604800,
        nullable: true,
        default: '',
    },
    {
        key: 'backuplong',
        group: 'performance',
        type: 'integer',
        label: 'Later backup interval (seconds)',
        description: 'Interval used for the following automatic backups. Leave empty for the game default.',
        min: 60,
        max: 604800,
        nullable: true,
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

const VALHEIM_LAUNCH_SETTINGS: LaunchSettingsAccessor = {
    definitions(server: GameServerRow): SettingDefinition[] {
        assertOvhcloudValheimServer(server);
        return VALHEIM_LAUNCH_DEFINITIONS;
    },

    read(_server: GameServerRow, env: EnvMap): Map<string, SettingValue> {
        const params = parseValheimParams(env.get(START_PARAMS_ENV) ?? '');
        const values = new Map<string, SettingValue>();

        values.set('serverName', env.get(SERVER_NAME_ENV) ?? 'Valheim server');
        values.set('serverPassword', env.get(SERVER_PASSWORD_ENV) ?? '');
        values.set('public', (env.get(PUBLIC_ENV) ?? '1') !== '0');
        values.set('updateOnStart', (env.get(UPDATE_ON_START_ENV) ?? 'false') === 'true');

        for (const key of Object.keys(VALUE_FLAGS)) {
            const raw = params.values.get(key);

            if (raw === undefined) {
                values.set(key, '');
                continue;
            }

            if (key === 'preset') {
                values.set(key, raw);
                continue;
            }

            const numeric = Number(raw);
            values.set(key, Number.isInteger(numeric) ? numeric : '');
        }

        for (const key of MODIFIER_KEYS) {
            values.set(`modifier.${key}`, params.modifiers.get(key) ?? '');
        }

        for (const name of SETKEY_NAMES) {
            values.set(`setkey.${name}`, params.setkeys.has(name));
        }

        for (const key of Object.keys(BARE_FLAGS)) {
            values.set(key, params.flags.has(key));
        }

        return values;
    },

    apply(_server: GameServerRow, env: EnvMap, updates: Map<string, SettingValue>): EnvMap {
        const params = parseValheimParams(env.get(START_PARAMS_ENV) ?? '');

        for (const [key, value] of updates) {
            if (key === 'serverName') {
                env.set(SERVER_NAME_ENV, String(value));
                continue;
            }
            if (key === 'serverPassword') {
                env.set(SERVER_PASSWORD_ENV, String(value));
                continue;
            }
            if (key === 'public') {
                env.set(PUBLIC_ENV, value ? '1' : '0');
                continue;
            }
            if (key === 'updateOnStart') {
                env.set(UPDATE_ON_START_ENV, value ? 'true' : 'false');
                continue;
            }

            if (BARE_FLAGS[key] !== undefined) {
                if (value) params.flags.add(key);
                else params.flags.delete(key);
                continue;
            }

            if (key.startsWith('modifier.')) {
                const modifierKey = key.slice('modifier.'.length);
                if (value === '') params.modifiers.delete(modifierKey);
                else params.modifiers.set(modifierKey, String(value));
                continue;
            }

            if (key.startsWith('setkey.')) {
                const name = key.slice('setkey.'.length);
                if (value) params.setkeys.add(name);
                else params.setkeys.delete(name);
                continue;
            }

            if (value === '') params.values.delete(key);
            else params.values.set(key, String(value));
        }

        const startParams = serializeValheimParams(params);
        if (startParams) env.set(START_PARAMS_ENV, startParams);
        else env.delete(START_PARAMS_ENV);

        return env;
    },
};

export function valheimLaunchSettingsAccessor(): LaunchSettingsAccessor {
    return VALHEIM_LAUNCH_SETTINGS;
}
