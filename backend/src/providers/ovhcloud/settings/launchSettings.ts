import type { GameServerRow } from '../../../types/gameServer.js';
import { parseStoredEnv } from '../../runtimeConfig.js';
import type {
    EnvMap,
    LaunchSettingsAccessor,
    Setting,
    SettingOption,
} from './types.js';
import { coerceSettingValue, fallbackSettingValue, invalidSettingInput } from './values.js';

function parseEnvMap(server: GameServerRow): EnvMap {
    const env: EnvMap = new Map();

    for (const entry of parseStoredEnv(server)) {
        const separator = entry.indexOf('=');
        env.set(entry.slice(0, separator), entry.slice(separator + 1));
    }

    return env;
}

export function envMapToArray(env: EnvMap): string[] {
    return [...env].map(([key, value]) => `${key}=${value}`);
}

export async function listLaunchSettings(
    server: GameServerRow,
    accessor: LaunchSettingsAccessor
): Promise<Setting[]> {
    const env = parseEnvMap(server);
    const definitions = await accessor.definitions(server, env);
    const values = accessor.read(server, env);

    return definitions.map((definition) => ({
        ...definition,
        value: values.get(definition.key) ?? fallbackSettingValue(definition),
    }));
}

export async function resolveLaunchSettingOptions(
    server: GameServerRow,
    accessor: LaunchSettingsAccessor,
    key: string,
    params: Record<string, string>
): Promise<SettingOption[]> {
    const env = parseEnvMap(server);
    const definitions = await accessor.definitions(server, env);

    if (!definitions.some((definition) => definition.key === key)) {
        invalidSettingInput(`Unsupported setting: ${key}`);
    }

    if (!accessor.resolveOptions) {
        throw Object.assign(new Error(`Setting has no dynamic options: ${key}`), { statusCode: 400 });
    }

    return accessor.resolveOptions(server, key, params);
}

export type LaunchEnvPatch = {
    updated: string[];
    nextEnv: EnvMap;
    changed: boolean;
};

export async function buildLaunchEnvPatch(
    server: GameServerRow,
    accessor: LaunchSettingsAccessor,
    updates: Record<string, unknown>
): Promise<LaunchEnvPatch> {
    const entries = Object.entries(updates);
    if (entries.length === 0) invalidSettingInput('settings must contain at least one value');

    const env = parseEnvMap(server);
    const definitions = await accessor.definitions(server, env);
    const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition]));

    const values = new Map<string, ReturnType<typeof coerceSettingValue>>();
    const updated: string[] = [];

    for (const [key, input] of entries) {
        const definition = definitionsByKey.get(key);
        if (!definition) invalidSettingInput(`Unsupported setting: ${key}`);

        values.set(key, coerceSettingValue(definition, input));
        updated.push(key);
    }

    const nextEnv = await accessor.apply(server, new Map(env), values);

    return {
        updated,
        nextEnv,
        changed: envMapToArray(env).join('\n') !== envMapToArray(nextEnv).join('\n'),
    };
}
