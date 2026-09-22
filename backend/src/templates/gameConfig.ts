import type { GameConfigDefinition, GameConfigField } from './types.js';

// Pure shared contract. Editing changes the file only; it never executes commands.
export function cs16GameConfig(path = '/serverfiles/cstrike/server.cfg', root = 'data'): GameConfigDefinition {
    const field = (key: string, label: string, description: string, type: GameConfigField['type'], extra: Partial<GameConfigField> = {}): GameConfigField => ({ key, label, description, type, apply: 'map-change', ...extra });
    return { format: 'valve-cfg', root, path, sections: [
        { id: 'general', label: 'Server identity', description: 'How players find and join your server.', fields: [
            field('hostname', 'Server name', 'Name shown in the game server browser.', 'text'),
            field('sv_password', 'Join password', 'Leave empty to allow everyone to join.', 'password'),
            field('sv_alltalk', 'All-talk voice', 'Allow voice communication across both teams.', 'boolean'),
        ] },
        { id: 'rounds', label: 'Rounds & rotation', description: 'Set the pace of each match.', fields: [
            field('mp_timelimit', 'Map time limit', 'Minutes per map. 0 disables the time limit.', 'number', { min: 0, max: 1440, step: 1 }),
            field('mp_roundtime', 'Round duration', 'Round length in minutes.', 'number', { min: 1, max: 9, step: 0.5 }),
            field('mp_freezetime', 'Freeze time', 'Seconds before players can move at the start of a round.', 'number', { min: 0, max: 60, step: 1 }),
            field('mp_buytime', 'Buy time', 'Minutes during which equipment can be purchased.', 'number', { min: 0.25, step: 0.05 }),
            field('mp_c4timer', 'Bomb timer', 'Seconds until the planted bomb explodes.', 'number', { min: 10, max: 90, step: 1 }),
        ] },
        { id: 'gameplay', label: 'Teams & gameplay', description: 'Choose the rules for your players.', fields: [
            field('mp_friendlyfire', 'Friendly fire', 'Allow teammates to damage each other.', 'boolean'),
            field('mp_autoteambalance', 'Auto team balance', 'Automatically balance team sizes.', 'boolean'),
            field('mp_limitteams', 'Team size difference', 'Maximum player difference between teams. 0 disables the limit.', 'number', { min: 0, max: 20, step: 1 }),
            field('mp_startmoney', 'Starting money', 'Money given when a player joins.', 'number', { min: 800, max: 16000, step: 100 }),
        ] },
    ] };
}

type Line = { raw: string; ending: string; key?: string; value?: string; prefix?: string; suffix?: string };
export function parseValveConfig(content: string) {
    const values: Record<string, string> = Object.create(null);
    const lines: Line[] = [];
    let issue = '';
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    for (const part of content.slice(bom.length).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) || []) {
        if (!part) continue;
        const ending = /(?:\r\n|\r|\n)$/.exec(part)?.[0] || '';
        const raw = part.slice(0, part.length - ending.length);
        let quoted = false, comment = raw.length;
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === '"') quoted = !quoted;
            if (!quoted && raw.slice(i, i + 2) === '//') { comment = i; break; }
            if (!quoted && (raw[i] === ';' || raw.slice(i, i + 2) === '/*' || raw.slice(i, i + 2) === '*/')) issue = 'This file contains compound commands or block comments. Use the file editor to preserve their behavior.';
        }
        if (quoted) issue = 'This file contains an unfinished quoted value. Correct it in the file editor first.';
        const code = raw.slice(0, comment);
        const match = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)([ \t]+)("[^"\r\n]*"|[^\s"]+)([ \t]*)$/.exec(code);
        if (match) {
            const key = match[2].toLowerCase();
            const value = match[4].startsWith('"') ? match[4].slice(1, -1) : match[4];
            values[key] = value;
            lines.push({ raw, ending, key, value, prefix: match[1] + match[2] + match[3], suffix: match[5] + raw.slice(comment) });
        } else {
            // Unknown syntax for a cvar cannot safely be replaced by appending another assignment.
            const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(code)?.[1].toLowerCase();
            lines.push({ raw, ending, key });
        }
    }
    return { lines, values, issue, bom };
}

export function validateConfigValue(field: GameConfigField, value: string): string | null {
    if (value.length > 256 || /[\x00-\x1f\x7f"\\;]/.test(value)) return 'Use up to 256 characters without quotes, backslashes, semicolons or line breaks.';
    if (field.type === 'boolean' && !['0', '1'].includes(value)) return 'Choose On or Off.';
    if (field.type === 'select' && !field.options?.some(o => o.value === value)) return 'Choose an available option.';
    if (field.type === 'number') {
        if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) return 'Enter a number.';
        const n = Number(value);
        if (field.min !== undefined && n < field.min) return `Minimum: ${field.min}.`;
        if (field.max !== undefined && n > field.max) return `Maximum: ${field.max}.`;
        // Step describes the UI increment; existing valid fractional values are not rounded.
    }
    return null;
}

export function updateValveConfig(content: string, definition: GameConfigDefinition, changes: Record<string, string>): string {
    const parsed = parseValveConfig(content);
    if (parsed.issue) throw new Error(parsed.issue);
    const fields = definition.sections.flatMap(s => s.fields);
    const ending = parsed.lines.find(l => l.ending)?.ending || '\n';
    for (const [key, value] of Object.entries(changes)) {
        const field = fields.find(f => f.key === key);
        if (!field) throw new Error('Unknown configuration field');
        const error = validateConfigValue(field, value);
        if (error) throw new Error(`${field.label}: ${error}`);
        const matches = parsed.lines.filter(l => l.key === key);
        if (matches.some(l => l.value === undefined)) throw new Error(`${field.label} uses a complex command. Edit it in the file editor.`);
        const last = matches[matches.length - 1];
        if (last) last.raw = `${last.prefix}"${value}"${last.suffix}`;
        else {
            const previous = parsed.lines[parsed.lines.length - 1];
            if (previous && !previous.ending) previous.ending = ending;
            parsed.lines.push({ raw: `${key} "${value}"`, ending });
        }
    }
    return parsed.bom + parsed.lines.map(l => l.raw + l.ending).join('');
}
