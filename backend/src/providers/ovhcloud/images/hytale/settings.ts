import { promises as fs } from 'node:fs';
import type { GameServerRow } from '../../../../types/gameServer.js';
import { resolveServerPath } from '../../../../services/fileExplorer.js';
import { ensureIsFile } from '../../../../utils/fsBrowser.js';
import type {
    FileSettingsAccessor,
    SettingDefinition,
    SettingValue,
} from '../../settings/types.js';
import { assertOvhcloudHytaleServer } from '../hytale.js';


const MAX_STRING_SETTING_LENGTH = 2048;
const HYTALE_SETTINGS_FILE_PATH = '/game/Server/config.json';

const HYTALE_SETTING_DEFINITIONS: SettingDefinition[] = [
    {
        key: 'ServerName',
        group: 'branding',
        label: 'Server name',
        description: 'Name of the server displayed to players in the Hytale server list.',
        type: 'string',
        maxLength: MAX_STRING_SETTING_LENGTH,
    },
    {
        key: 'MOTD',
        group: 'branding',
        label: 'Server MOTD',
        description: 'Message of the day displayed to players when connecting to the server.',
        type: 'string',
        maxLength: MAX_STRING_SETTING_LENGTH,
    },
    {
        key: 'Password',
        group: 'security',
        label: 'Server password',
        description: 'Password required to join the server. Leave empty to make the server public.',
        type: 'string',
        secret: true,
        maxLength: MAX_STRING_SETTING_LENGTH,
    },
    {
        key: 'MaxPlayers',
        group: 'players',
        label: 'Maximum players',
        description: 'Maximum number of players that can connect to the server at the same time.',
        type: 'integer',
        min: 1,
        max: 1000,
    },
    {
        key: 'MaxViewRadius',
        group: 'performance',
        label: 'Maximum view radius',
        description: 'Maximum view distance sent to players, in chunks. Lower values improve performance and reduce memory usage.',
        type: 'integer',
        min: 1,
        max: 64,
    },
];

type HytaleSettingsSnapshot = { filePath: string; document: Record<string, unknown> };

async function resolveHytaleSettingsFile(serverId: number): Promise<{ absPath: string; rootDir: string }> {
    const resolved = await resolveServerPath({ serverId, root: 'data', path: HYTALE_SETTINGS_FILE_PATH });
    await ensureIsFile(resolved.absPath, resolved.rootDir);
    return {
        absPath: resolved.absPath,
        rootDir: resolved.rootDir,
    };
}

async function readHytaleSettingsFile(serverId: number): Promise<HytaleSettingsSnapshot> {
    const resolved = await resolveHytaleSettingsFile(serverId);
    const raw = await fs.readFile(resolved.absPath, 'utf8');

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw Object.assign(new Error('Hytale settings file contains invalid JSON'), { statusCode: 500 });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw Object.assign(new Error('Hytale settings file must contain a JSON object'), { statusCode: 500 });
    }

    return {
        filePath: resolved.absPath,
        document: parsed as Record<string, unknown>,
    };
}

function parseJsonValue(definition: SettingDefinition, rawValue: unknown): SettingValue | null {
    if (definition.type === 'integer') {
        return typeof rawValue === 'number' && Number.isInteger(rawValue) ? rawValue : null;
    }

    return typeof rawValue === 'string' ? rawValue : null;
}

const HYTALE_FILE_SETTINGS: FileSettingsAccessor<HytaleSettingsSnapshot> = {
    onMissing: 'omit',

    definitions(): SettingDefinition[] {
        return HYTALE_SETTING_DEFINITIONS;
    },

    async load(server: GameServerRow): Promise<HytaleSettingsSnapshot> {
        assertOvhcloudHytaleServer(server);
        return readHytaleSettingsFile(server.id);
    },

    read(snapshot: HytaleSettingsSnapshot, definition: SettingDefinition): SettingValue | null {
        if (!Object.prototype.hasOwnProperty.call(snapshot.document, definition.key)) return null;
        return parseJsonValue(definition, snapshot.document[definition.key]);
    },

    write(snapshot: HytaleSettingsSnapshot, definition: SettingDefinition, value: SettingValue): boolean {
        if (!Object.prototype.hasOwnProperty.call(snapshot.document, definition.key)) return false;

        snapshot.document[definition.key] = value;
        return true;
    },

    async save(_server: GameServerRow, snapshot: HytaleSettingsSnapshot): Promise<void> {
        await fs.writeFile(snapshot.filePath, `${JSON.stringify(snapshot.document, null, 2)}\n`, 'utf8');
    },
};

export function hytaleFileSettingsAccessor(): FileSettingsAccessor<HytaleSettingsSnapshot> {
    return HYTALE_FILE_SETTINGS;
}
