// Skoczi: persisted, revision-checked panel settings. No host network mutations.
import { enterPortAllocationMutation } from './portAllocationLock.js';
import type { Database } from 'sqlite';
import { assertPortPolicy, configuredPortPolicy, isUnicastIPv4 } from '../utils/portPolicy.js';

export type Allocation = { ip: string; alias: string; tcp: string; udp: string };
export type LoginTheme = 'light' | 'dark' | 'system';
export const DEFAULT_APPEARANCE = {
    showFollowUs: false, showTrustpilot: false, showNews: false,
    siteName: 'Game Panel PRO', siteSubtitle: 'Server management', logo: '', favicon: '',
    loginDescription: 'Sign in to manage your game servers',
    loginTheme: 'light' as LoginTheme,
    showLoginFooter: true, loginFooter: 'Based on OVHcloud Game Panel · Developed by Skoczi',
};
export type GlobalSettings = {
    appearance: typeof DEFAULT_APPEARANCE;
    network: { restrictPorts: boolean; allocations: Allocation[] };
};
export type SettingsSnapshot = GlobalSettings & { revision: number };
export type Assignment = { serverId: number; serverName: string; protocol: 'tcp' | 'udp'; ip: string; port: number };

function invalid(message: string, statusCode = 400): never { throw Object.assign(new Error(message), { statusCode }); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid('Invalid settings fields');
    return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
    if (typeof value !== 'string' || value.length > max) invalid(`Expected text of at most ${max} characters`);
    return value.trim();
}

function logo(value: unknown, favicon = false): string {
    const source = text(value, 350000);
    if (!source) return '';
    if (source.startsWith('https://') && source.length <= 2048) {
        try {
            const url = new URL(source);
            if (!url.username && !url.password) return url.href;
        } catch { /* Continue to the validation error below. */ }
    }
    if (favicon && /^data:image\/(?:x-icon|vnd.microsoft.icon);base64,/.test(source)) {
        const encoded = source.split(',')[1];
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length >= 22 && bytes.length <= 256 * 1024 && bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) && bytes.readUInt16LE(4) > 0 && bytes.toString('base64') === encoded) return source;
    }
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
    if (match) {
        const data = Buffer.from(match[2], 'base64');
        const valid = match[1] === 'png' ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            : match[1] === 'jpeg' ? data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
            : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
        if (valid && data.length <= 256 * 1024 && data.toString('base64') === match[2]) return source;
    }
    invalid(`${favicon ? 'Favicon' : 'Logo'} must be an HTTPS image URL or a PNG, JPEG, WebP${favicon ? ' or ICO' : ''} upload up to 256 KiB`);
}

export function validateGlobalSettings(input: unknown): GlobalSettings {
    const root = object(input, ['appearance', 'network']);
    const appearance = object(root.appearance, Object.keys(DEFAULT_APPEARANCE));
    const network = object(root.network, ['restrictPorts', 'allocations']);
    if (typeof appearance.showFollowUs !== 'boolean' || typeof appearance.showTrustpilot !== 'boolean' || typeof appearance.showNews !== 'boolean' || typeof appearance.showLoginFooter !== 'boolean' || typeof network.restrictPorts !== 'boolean') invalid('Settings switches must be booleans');
    if (!Array.isArray(network.allocations) || network.allocations.length > 128) invalid('At most 128 IP allocations are supported');
    const ips = new Set<string>();
    const allocations = network.allocations.map((item): Allocation => {
        const row = object(item, ['ip', 'alias', 'tcp', 'udp']);
        const ip = text(row.ip, 15);
        if (!isUnicastIPv4(ip) || ips.has(ip)) invalid('Each allocation must have a unique unicast IPv4');
        ips.add(ip);
        return { ip, alias: text(row.alias, 80), tcp: text(row.tcp, 1024), udp: text(row.udp, 1024) };
    });
    const siteName = text(appearance.siteName, 80);
    if (!['light', 'dark', 'system'].includes(appearance.loginTheme as string)) invalid('Invalid login theme');
    if (!siteName) invalid('Site name cannot be empty');
    const result = { appearance: { showFollowUs: appearance.showFollowUs, showTrustpilot: appearance.showTrustpilot,
        showNews: appearance.showNews, showLoginFooter: appearance.showLoginFooter, siteName,
        siteSubtitle: text(appearance.siteSubtitle, 120), logo: logo(appearance.logo), favicon: logo(appearance.favicon ?? '', true),
        loginDescription: text(appearance.loginDescription, 240), loginFooter: text(appearance.loginFooter, 240),
        loginTheme: appearance.loginTheme as LoginTheme,
    }, network: { restrictPorts: network.restrictPorts, allocations } };
    try { allocationPolicy(result.network); } catch (error) { invalid(error instanceof Error ? error.message : 'Invalid port ranges'); }
    return result;
}

export function allocationPolicy(network: GlobalSettings['network']) {
    // Validate even when restriction is disabled, so toggling it on cannot activate invalid data.
    const parsed = configuredPortPolicy(JSON.stringify(Object.fromEntries(network.allocations.map(({ ip, tcp, udp }) => [ip, { tcp, udp }]))));
    return network.restrictPorts ? parsed : null;
}

export class GlobalSettingsStore {
    private current: SettingsSnapshot | undefined;
    constructor(private db: Database, private apply: (settings: GlobalSettings) => void) {}

    async initialize(seed: GlobalSettings): Promise<void> {
        await this.db.exec('CREATE TABLE IF NOT EXISTS panel_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, settings_json TEXT NOT NULL)');
        const existing = await this.db.get('SELECT revision, settings_json FROM panel_settings WHERE id=1');
        if (!existing) {
            const initial = validateGlobalSettings(seed);
            await this.db.run('INSERT OR IGNORE INTO panel_settings (id, revision, settings_json) VALUES (1, 1, ?)', JSON.stringify(initial));
        }
        const row = await this.db.get('SELECT revision, settings_json FROM panel_settings WHERE id=1');
        if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid persisted panel settings');
        const stored = JSON.parse(row.settings_json);
        const oldAppearance = object(stored.appearance, Object.keys(DEFAULT_APPEARANCE));
        // Add only the new fields when upgrading .3; old switches remain required.
        const { showFollowUs: _follow, showTrustpilot: _trust, ...newDefaults } = DEFAULT_APPEARANCE;
        const settings = validateGlobalSettings({ ...stored, appearance: { ...newDefaults, ...oldAppearance } });
        if (Object.keys(newDefaults).some((key) => !(key in oldAppearance))) {
            const changed = await this.db.run('UPDATE panel_settings SET settings_json=?, revision=revision+1 WHERE id=1 AND revision=?', JSON.stringify(settings), row.revision);
            if (changed.changes !== 1) throw new Error('Settings changed during migration');
            row.revision++;
        }
        this.current = { ...settings, revision: row.revision };
        this.apply(settings);
    }

    snapshot(): SettingsSnapshot {
        if (!this.current) throw new Error('Panel settings are not initialized');
        return JSON.parse(JSON.stringify(this.current));
    }

    async assignments(): Promise<Assignment[]> {
        const rows = await this.db.all<Array<{ id: number; name: string; ports_json: string }>>('SELECT id, name, ports_json FROM game_servers ORDER BY name');
        const result: Assignment[] = [];
        for (const row of rows) {
            let ports;
            try { ports = JSON.parse(row.ports_json); } catch { invalid(`Invalid saved ports for ${row.name}`, 409); }
            for (const protocol of ['tcp', 'udp'] as const) {
                if (!ports || !Array.isArray(ports[protocol])) invalid(`Invalid saved ports for ${row.name}`, 409);
                for (const port of ports[protocol]) {
                    if (!port || !Number.isInteger(port.host) || port.host < 1 || port.host > 65535 || (port.hostIp !== undefined && typeof port.hostIp !== 'string')) invalid(`Invalid saved ports for ${row.name}`, 409);
                    result.push({ serverId: row.id, serverName: row.name, protocol, ip: port.hostIp || '', port: port.host });
                }
            }
        }
        return result;
    }

    async save(input: unknown, revision: unknown): Promise<SettingsSnapshot> {
        const release = enterPortAllocationMutation();
        try {
            if (!Number.isSafeInteger(revision) || revision !== this.snapshot().revision) invalid('Settings changed. Reload before saving.', 409);
            const next = validateGlobalSettings(input);
            if (JSON.stringify(next.network) !== JSON.stringify(this.current!.network)) {
                const policy = allocationPolicy(next.network);
                const ips = new Set(next.network.allocations.map((entry) => entry.ip));
                for (const used of await this.assignments()) {
                    try {
                        if (used.ip && !ips.has(used.ip)) throw new Error('IP removed');
                        assertPortPolicy({ tcp: [], udp: [], [used.protocol]: [{ hostIp: used.ip, host: used.port }] }, policy);
                    } catch { invalid(`Allocation in use by ${used.serverName}: ${used.ip || 'Docker default'}:${used.port}/${used.protocol}. Change the server binding first.`, 409); }
                }
            }
            const updated = await this.db.run('UPDATE panel_settings SET settings_json=?, revision=revision+1 WHERE id=1 AND revision=?', JSON.stringify(next), revision);
            if (updated.changes !== 1) invalid('Settings changed. Reload before saving.', 409);
            // No await between updating the snapshot and applying policy.
            this.current = { ...next, revision: Number(revision) + 1 };
            this.apply(next);
            return this.snapshot();
        } finally { release(); }
    }
}
