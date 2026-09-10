import { promises as fs } from 'node:fs';
import type { GameServerRow } from '../../../../types/gameServer.js';
import { resolveServerPath } from '../../../../services/fileExplorer.js';
import { ensureIsFile } from '../../../../utils/fsBrowser.js';
import type {
    FileSettingsAccessor,
    SettingDefinition,
    SettingValue,
} from '../../settings/types.js';
import { assertOvhcloudPalworldServer } from '../palworld.js';


const MAX_STRING_SETTING_LENGTH = 2048;
const PALWORLD_SETTINGS_FILE_PATH = '/server/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini';
const PALWORLD_DEFAULT_SETTINGS_FILE_PATH = '/server/DefaultPalWorldSettings.ini';

const SAFE_TEXT_PATTERN = '^[^"(),]*$';
const SAFE_TEXT_MESSAGE = 'Double quotes, parentheses and commas are not allowed in this value.';

const PALWORLD_SETTING_DEFINITIONS: SettingDefinition[] = [
    {
        key: 'ServerName',
        group: 'branding',
        label: 'Server name',
        description: 'Name of the server shown in the community server list.',
        type: 'string',
        maxLength: MAX_STRING_SETTING_LENGTH,
        pattern: SAFE_TEXT_PATTERN,
        patternMessage: SAFE_TEXT_MESSAGE,
    },
    {
        key: 'ServerDescription',
        group: 'branding',
        label: 'Server description',
        description: 'Short description shown next to the server name.',
        type: 'string',
        maxLength: MAX_STRING_SETTING_LENGTH,
        pattern: SAFE_TEXT_PATTERN,
        patternMessage: SAFE_TEXT_MESSAGE,
    },
    {
        key: 'ServerPassword',
        group: 'security',
        label: 'Server password',
        description: 'Password required to join. Leave empty to make the server public.',
        type: 'string',
        secret: true,
        maxLength: MAX_STRING_SETTING_LENGTH,
        pattern: SAFE_TEXT_PATTERN,
        patternMessage: SAFE_TEXT_MESSAGE,
    },
    {
        key: 'ServerPlayerMaxNum',
        group: 'players',
        label: 'Maximum players',
        description: 'Maximum number of players allowed on the server (dedicated servers are capped at 32).',
        type: 'integer',
        min: 1,
        max: 32,
    },
    {
        key: 'DeathPenalty',
        group: 'gameplay',
        label: 'Death penalty',
        description: 'What a player loses when they die.',
        type: 'select',
        options: [
            { value: 'None', label: 'None' },
            { value: 'Item', label: 'Item' },
            { value: 'ItemAndEquipment', label: 'ItemAndEquipment' },
            { value: 'All', label: 'All' },
        ],
    },
    {
        key: 'ExpRate',
        group: 'gameplay',
        label: 'EXP rate',
        description: 'Experience gain multiplier for players and Pals.',
        type: 'float',
        min: 0.1,
        max: 20,
    },
    {
        key: 'PalCaptureRate',
        group: 'gameplay',
        label: 'Pal capture rate',
        description: 'Capture rate multiplier for Pals.',
        type: 'float',
        min: 0.5,
        max: 2,
    },
    {
        key: 'CollectionDropRate',
        group: 'gameplay',
        label: 'Gatherable drop rate',
        description: 'Multiplier for items gathered from nodes (trees, rocks, ...).',
        type: 'float',
        min: 0.5,
        max: 5,
    },
    {
        key: 'EnemyDropItemRate',
        group: 'gameplay',
        label: 'Enemy drop rate',
        description: 'Multiplier for items dropped by defeated enemies.',
        type: 'float',
        min: 0.5,
        max: 5,
    },
    {
        key: 'WorkSpeedRate',
        group: 'gameplay',
        label: 'Work speed rate',
        description: 'Multiplier for how fast Pals work at bases.',
        type: 'float',
        min: 0.1,
        max: 5,
    },
    {
        key: 'MonsterFarmActionSpeedRate',
        group: 'gameplay',
        label: 'Ranch production speed rate',
        description: 'Multiplier for how fast Pals produce items at the Ranch.',
        type: 'float',
        min: 0.1,
        max: 5,
    },
    {
        key: 'bEnableFastTravel',
        group: 'gameplay',
        label: 'Enable fast travel',
        description: 'Allow players to use fast travel points.',
        type: 'boolean',
    },
    {
        key: 'bIsStartLocationSelectByMap',
        group: 'world',
        label: 'Choose start location on map',
        description: 'Let players pick their starting location on the map.',
        type: 'boolean',
    },
    {
        key: 'PalEggDefaultHatchingTime',
        group: 'gameplay',
        label: 'Egg hatching time (hours)',
        description: 'Time in hours needed to hatch a huge egg.',
        type: 'float',
        min: 0,
        max: 240,
    },
    {
        key: 'DropItemAliveMaxHours',
        group: 'world',
        label: 'Dropped item lifetime (hours)',
        description: 'How long dropped items stay in the world, in hours.',
        type: 'float',
        min: 0,
        max: 240,
    },
    {
        key: 'bEnableVoiceChat',
        group: 'players',
        label: 'Enable voice chat',
        description: 'Enable in-game proximity voice chat on the server.',
        type: 'boolean',
    },
    {
        key: 'VoiceChatMaxVolumeDistance',
        group: 'players',
        label: 'Voice full-volume distance',
        description: 'Distance within which voice chat plays at full volume (Unreal units; 100 = 1 m, so 3000 = ~30 m).',
        type: 'float',
    },
    {
        key: 'VoiceChatZeroVolumeDistance',
        group: 'players',
        label: 'Voice cutoff distance',
        description: 'Distance beyond which voice chat becomes inaudible (Unreal units; 100 = 1 m, so 15000 = ~150 m).',
        type: 'float',
    },
];


function splitTopLevel(inner: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inQuotes = false;
    let current = '';

    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (!inQuotes && ch === '(') {
            depth++;
            current += ch;
        } else if (!inQuotes && ch === ')') {
            depth--;
            current += ch;
        } else if (!inQuotes && depth === 0 && ch === ',') {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

function parsePairs(inner: string): { keys: string[]; values: Map<string, string> } {
    const keys: string[] = [];
    const values = new Map<string, string>();

    for (const segment of splitTopLevel(inner)) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const rawValue = trimmed.slice(eq + 1);
        if (!key) continue;
        if (!values.has(key)) keys.push(key);
        values.set(key, rawValue);
    }

    return { keys, values };
}

function findOptionSettingsLine(content: string): { index: number; inner: string } | null {
    const lines = content.split('\n');
    const index = lines.findIndex((line) => line.trimStart().startsWith('OptionSettings='));
    if (index < 0) return null;

    const line = lines[index];
    const open = line.indexOf('(');
    const close = line.lastIndexOf(')');
    if (open < 0 || close < open) return { index, inner: '' };

    return { index, inner: line.slice(open + 1, close) };
}

async function readOptionSettingsValues(
    serverId: number,
    filePath: string,
    mustExist: boolean
): Promise<Map<string, string>> {
    let content: string;
    try {
        const resolved = await resolveServerPath({ serverId, root: 'data', path: filePath });
        if (mustExist) await ensureIsFile(resolved.absPath, resolved.rootDir);
        content = await fs.readFile(resolved.absPath, 'utf8');
    } catch (error) {
        if (mustExist) throw error;
        return new Map();
    }

    const found = findOptionSettingsLine(content);
    return found ? parsePairs(found.inner).values : new Map();
}

function unquote(rawValue: string): string {
    const trimmed = rawValue.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseIniValue(definition: SettingDefinition, rawValue: string): SettingValue | null {
    switch (definition.type) {
        case 'boolean': {
            const normalized = rawValue.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
            return null;
        }
        case 'integer': {
            const parsed = Number(rawValue.trim());
            return Number.isInteger(parsed) ? parsed : null;
        }
        case 'float': {
            const parsed = Number(rawValue.trim());
            return Number.isFinite(parsed) ? parsed : null;
        }
        case 'select':
        case 'string':
            return unquote(rawValue);
    }
}

function renderIniValue(definition: SettingDefinition, value: SettingValue): string {
    switch (definition.type) {
        case 'boolean': return value ? 'True' : 'False';
        case 'integer':
        case 'float': return String(value);
        case 'select': return String(value);
        case 'string': return `"${value}"`;
    }
}

type PalworldSettingsSnapshot = {
    absPath: string;
    lines: string[];
    optionLineIndex: number;
    keys: string[];
    values: Map<string, string>;
    defaults: Map<string, string>;
};

const PALWORLD_FILE_SETTINGS: FileSettingsAccessor<PalworldSettingsSnapshot> = {
    onMissing: 'omit',

    definitions(): SettingDefinition[] {
        return PALWORLD_SETTING_DEFINITIONS;
    },

    async load(server: GameServerRow): Promise<PalworldSettingsSnapshot> {
        assertOvhcloudPalworldServer(server);

        const resolved = await resolveServerPath({
            serverId: server.id,
            root: 'data',
            path: PALWORLD_SETTINGS_FILE_PATH,
        });
        await ensureIsFile(resolved.absPath, resolved.rootDir);
        const content = await fs.readFile(resolved.absPath, 'utf8');

        const found = findOptionSettingsLine(content);
        if (!found) {
            throw Object.assign(new Error('PalWorldSettings.ini has no OptionSettings entry'), { statusCode: 500 });
        }

        const { keys, values } = parsePairs(found.inner);

        return {
            absPath: resolved.absPath,
            lines: content.split('\n'),
            optionLineIndex: found.index,
            keys,
            values,
            defaults: await readOptionSettingsValues(server.id, PALWORLD_DEFAULT_SETTINGS_FILE_PATH, false),
        };
    },

    read(snapshot: PalworldSettingsSnapshot, definition: SettingDefinition): SettingValue | null {
        const rawValue = snapshot.values.get(definition.key) ?? snapshot.defaults.get(definition.key);
        return rawValue === undefined ? null : parseIniValue(definition, rawValue);
    },

    write(snapshot: PalworldSettingsSnapshot, definition: SettingDefinition, value: SettingValue): boolean {
        if (!snapshot.values.has(definition.key)) snapshot.keys.push(definition.key);
        snapshot.values.set(definition.key, renderIniValue(definition, value));
        return true;
    },

    async save(_server: GameServerRow, snapshot: PalworldSettingsSnapshot): Promise<void> {
        const inner = snapshot.keys.map((key) => `${key}=${snapshot.values.get(key)}`).join(',');
        snapshot.lines[snapshot.optionLineIndex] = `OptionSettings=(${inner})`;
        await fs.writeFile(snapshot.absPath, snapshot.lines.join('\n'), 'utf8');
    },
};

export function palworldFileSettingsAccessor(): FileSettingsAccessor<PalworldSettingsSnapshot> {
    return PALWORLD_FILE_SETTINGS;
}
