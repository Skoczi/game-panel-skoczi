import type { GameServerRow } from '../../../types/gameServer.js';
import * as dockerUtils from '../../../utils/docker.js';
import type {
    FileSettingsAccessor,
    FileSettingsPatchResult,
    Setting,
    SettingsWritePolicy,
} from './types.js';
import { coerceSettingValue, invalidSettingInput } from './values.js';

const DEFAULT_POLICY: SettingsWritePolicy = { writableWhileRunning: true };

export async function resolveFileSettingsPolicy(
    server: GameServerRow,
    accessor: FileSettingsAccessor
): Promise<SettingsWritePolicy> {
    return accessor.policy ? await accessor.policy(server) : DEFAULT_POLICY;
}

export async function listFileSettings(
    server: GameServerRow,
    accessor: FileSettingsAccessor
): Promise<Setting[]> {
    const definitions = accessor.definitions(server);
    const snapshot = await accessor.load(server);
    const settings: Setting[] = [];

    for (const definition of definitions) {
        const value = accessor.read(snapshot, definition);

        if (value === null) {
            if (accessor.onMissing === 'omit' || definition.default === undefined) continue;
            settings.push({ ...definition, value: definition.default });
            continue;
        }

        settings.push({ ...definition, value });
    }

    return settings;
}

async function assertWritable(server: GameServerRow, policy: SettingsWritePolicy): Promise<void> {
    if (policy.writableWhileRunning || !server.docker_container_id) return;

    const status = await dockerUtils.checkContainerStatus(server.docker_container_id);
    if (status !== 'running') return;

    throw Object.assign(
        new Error(policy.writeBlockedReason ?? 'Stop the server before changing these settings.'),
        { statusCode: 409 }
    );
}

export async function patchFileSettings(
    server: GameServerRow,
    accessor: FileSettingsAccessor,
    updates: Record<string, unknown>
): Promise<FileSettingsPatchResult> {
    const entries = Object.entries(updates);
    if (entries.length === 0) invalidSettingInput('settings must contain at least one value');

    await assertWritable(server, await resolveFileSettingsPolicy(server, accessor));

    const definitionsByKey = new Map(accessor.definitions(server).map((entry) => [entry.key, entry]));
    const snapshot = await accessor.load(server);
    const updated: string[] = [];

    for (const [key, input] of entries) {
        const definition = definitionsByKey.get(key);
        if (!definition) invalidSettingInput(`Unsupported setting: ${key}`);

        const value = coerceSettingValue(definition, input);

        if (!accessor.write(snapshot, definition, value)) {
            throw Object.assign(
                new Error(`Setting is not present in the server configuration: ${key}`),
                { statusCode: 404 }
            );
        }

        updated.push(key);
    }

    await accessor.save(server, snapshot);

    return {
        updated,
        settings: await listFileSettings(server, accessor),
    };
}
