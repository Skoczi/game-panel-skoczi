import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GameServerRow } from '../../../../types/gameServer.js';
import { resolveServerPath } from '../../../../services/fileExplorer.js';
import { getRuntimeOwnership } from '../../../runtimeConfig.js';
import type {
    FileSettingsAccessor,
    SettingDefinition,
    SettingValue,
} from '../../settings/types.js';
import { assertOvhcloudRustServer, resolveRustIdentity } from '../rust.js';

const MAX_STRING_SETTING_LENGTH = 2048;

const NO_QUOTE_PATTERN = '^[^"]*$';
const NO_QUOTE_MESSAGE = 'Double quotes are not allowed in this value.';

function text(
    key: string,
    label: string,
    description: string,
    group: SettingDefinition['group']
): SettingDefinition {
    return {
        key,
        group,
        type: 'string',
        label,
        description,
        default: '',
        maxLength: MAX_STRING_SETTING_LENGTH,
        pattern: NO_QUOTE_PATTERN,
        patternMessage: NO_QUOTE_MESSAGE,
    };
}

const RUST_SETTING_DEFINITIONS: SettingDefinition[] = [
    text('server.hostname', 'Server name', 'Name shown in the in-game server browser.', 'branding'),
    text('server.description', 'Server description', 'Description shown on the server details / connection screen.', 'branding'),
    text('server.url', 'Website URL', 'Link opened from the server browser (website or Discord).', 'branding'),
    text('server.headerimage', 'Header image URL', 'Banner shown in the server browser. Must be a 512x256 image URL.', 'branding'),
    text('server.logoimage', 'Logo image URL', 'Server logo shown in the in-game menu. Publicly hosted image URL.', 'branding'),
    text('server.tags', 'Browser tags', 'Comma-separated discovery tags shown in the browser (e.g. "weekly,vanilla,EU").', 'branding'),

    { key: 'server.maxplayers', group: 'players', type: 'integer', default: 100, min: 1, label: 'Maximum players', description: 'Maximum concurrent players. Higher values need more CPU/RAM.' },
    { key: 'relationshipmanager.maxteamsize', group: 'players', type: 'integer', default: 8, min: 0, label: 'Maximum team size', description: 'Maximum members per team (0 = teams disabled / solo only).' },

    { key: 'server.pve', group: 'gameplay', type: 'boolean', default: false, label: 'PvE mode', description: 'Disable player-versus-player damage (players cannot hurt each other).' },
    { key: 'server.radiation', group: 'gameplay', type: 'boolean', default: true, label: 'Radiation', description: 'Enable radiation zones around monuments.' },
    { key: 'server.stability', group: 'gameplay', type: 'boolean', default: true, label: 'Building stability', description: 'Enable building stability (structures can collapse). Disabling it reduces server load.' },
    { key: 'server.globalchat', group: 'gameplay', type: 'boolean', default: true, label: 'Global chat', description: 'Enable server-wide chat (disable for proximity-only chat).' },
    { key: 'craft.instant', group: 'gameplay', type: 'boolean', default: false, label: 'Instant crafting', description: 'Items are crafted instantly with no wait time.' },
    { key: 'decay.scale', group: 'gameplay', type: 'float', default: 1, min: 0, label: 'Decay scale', description: 'Building decay speed multiplier (1 = normal, 0.5 = slower, 0 = disabled).' },
    { key: 'decay.upkeep', group: 'gameplay', type: 'boolean', default: true, label: 'Upkeep', description: 'Require resources in the tool cupboard to prevent building decay.' },

    { key: 'server.saveinterval', group: 'performance', type: 'integer', default: 300, min: 60, max: 3600, label: 'Save interval (seconds)', description: 'Seconds between automatic world saves.' },
];

const RUST_SERVER_CFG_RELATIVE_PATH = 'cfg/server.cfg';

function serverCfgApiPath(server: GameServerRow): string {
    return `/server/server/${resolveRustIdentity(server)}/${RUST_SERVER_CFG_RELATIVE_PATH}`;
}

async function readServerCfg(server: GameServerRow): Promise<string | null> {
    const resolved = await resolveServerPath({ serverId: server.id, root: 'data', path: serverCfgApiPath(server) });
    try {
        return await fs.readFile(resolved.absPath, 'utf8');
    } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw error;
    }
}

async function writeServerCfg(server: GameServerRow, content: string): Promise<void> {
    const resolved = await resolveServerPath({ serverId: server.id, root: 'data', path: serverCfgApiPath(server) });
    await fs.mkdir(path.dirname(resolved.absPath), { recursive: true });
    await fs.writeFile(resolved.absPath, content, 'utf8');

    const ownership = getRuntimeOwnership(server);
    if (ownership) {
        await fs.chown(path.dirname(resolved.absPath), ownership.uid, ownership.gid).catch(() => undefined);
        await fs.chown(resolved.absPath, ownership.uid, ownership.gid).catch(() => undefined);
    }
}

function unquote(rawValue: string): string {
    const trimmed = rawValue.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function getCfgRawValue(content: string, key: string): string | null {
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;

        const separator = line.search(/\s/);
        if (separator < 0) continue;
        if (line.slice(0, separator) !== key) continue;

        return line.slice(separator + 1).trim();
    }
    return null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setCfgRawValue(content: string, key: string, rawValue: string): string {
    const lines = content.split('\n');
    const re = new RegExp(`^\\s*${escapeRegExp(key)}\\s`);

    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
            lines[i] = `${key} ${rawValue}`;
            return lines.join('\n');
        }
    }

    const body = content.length === 0 ? '' : content.endsWith('\n') ? content : `${content}\n`;
    return `${body}${key} ${rawValue}\n`;
}

function parseCfgValue(definition: SettingDefinition, raw: string): SettingValue | null {
    switch (definition.type) {
        case 'boolean': {
            const normalized = unquote(raw).toLowerCase();
            if (normalized === 'true' || normalized === '1') return true;
            if (normalized === 'false' || normalized === '0') return false;
            return null;
        }
        case 'integer': {
            const parsed = Number(unquote(raw));
            return Number.isInteger(parsed) ? parsed : null;
        }
        case 'float': {
            const parsed = Number(unquote(raw));
            return Number.isFinite(parsed) ? parsed : null;
        }
        case 'select':
        case 'string':
            return unquote(raw);
    }
}

function renderCfgValue(definition: SettingDefinition, value: SettingValue): string {
    switch (definition.type) {
        case 'boolean': return value ? 'true' : 'false';
        case 'integer':
        case 'float': return String(value);
        case 'select':
        case 'string': return `"${value}"`;
    }
}

type RustCfgSnapshot = { content: string };

const RUST_FILE_SETTINGS: FileSettingsAccessor<RustCfgSnapshot> = {
    onMissing: 'default',

    definitions(): SettingDefinition[] {
        return RUST_SETTING_DEFINITIONS;
    },

    async load(server: GameServerRow): Promise<RustCfgSnapshot> {
        assertOvhcloudRustServer(server);
        return { content: await readServerCfg(server) ?? '' };
    },

    read(snapshot: RustCfgSnapshot, definition: SettingDefinition): SettingValue | null {
        const raw = getCfgRawValue(snapshot.content, definition.key);
        return raw === null ? null : parseCfgValue(definition, raw);
    },

    write(snapshot: RustCfgSnapshot, definition: SettingDefinition, value: SettingValue): boolean {
        snapshot.content = setCfgRawValue(snapshot.content, definition.key, renderCfgValue(definition, value));
        return true;
    },

    async save(server: GameServerRow, snapshot: RustCfgSnapshot): Promise<void> {
        await writeServerCfg(server, snapshot.content);
    },
};

export function rustFileSettingsAccessor(): FileSettingsAccessor<RustCfgSnapshot> {
    return RUST_FILE_SETTINGS;
}
