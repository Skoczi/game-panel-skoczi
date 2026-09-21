// Pure argv helpers shared with the editor. Never execute or evaluate shell text.
export function gameStartup(argv: string[]): { command: string[]; wrapped: boolean } | null {
    if (!argv.length) return null;
    if (/^(?:.*\/)?(?:bash|sh)$/.test(argv[0]) && argv[1] === '-c') {
        // Preserve the setup script and shell's $0; expose only the final exec and $@.
        const match = /(?:^|\n)exec\s+([./A-Za-z0-9_-]+)\s+"\$@"\s*$/.exec(argv[2] || '');
        return match && argv.length >= 4 ? { command: [match[1], ...argv.slice(4)], wrapped: true } : null;
    }
    return { command: [...argv], wrapped: false };
}
export function formatStartup(argv: string[]): string {
    return argv.map(arg => /^[A-Za-z0-9_./:+,=@%{}-]+$/.test(arg) ? arg : "'" + arg.replace(/'/g, "'\\''") + "'").join(' ');
}
export function parseStartup(text: string): string[] {
    if (text.length > 8192 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Use a single command line.');
    const args: string[] = []; let value = ''; let quote = ''; let escaped = false; let active = false;
    for (const c of text) {
        if (escaped) { value += c; escaped = false; active = true; continue; }
        if (c === '\\' && quote !== "'") { escaped = true; active = true; continue; }
        if (quote) { if (c === quote) quote = ''; else value += c; active = true; continue; }
        if (c === "'" || c === '"') { quote = c; active = true; continue; }
        if (c === ' ') { if (active) { args.push(value); value = ''; active = false; } continue; }
        value += c; active = true;
    }
    if (quote || escaped) throw new Error('Close the quote or escape in the startup command.');
    if (active) args.push(value);
    if (!args.length || args.length > 256) throw new Error('Enter a valid startup command.');
    return args;
}
export function applyStartupOverride(original: string[], override: unknown, allowedVariables: string[]): string[] {
    if (override == null) return original;
    const game = gameStartup(original);
    if (!game || !Array.isArray(override) || !override.length || override.length > 256 || override.some(a => typeof a !== 'string' || /[\x00-\x1f\x7f]/.test(a)) || JSON.stringify(override).length > 8192) throw new Error('Invalid startup parameters.');
    if (override[0] !== game.command[0]) throw new Error('Keep the game executable; edit its parameters only.');
    for (const arg of override) for (const match of arg.matchAll(/\{\{([^{}]+)\}\}/g)) {
        if (!allowedVariables.includes(match[1])) throw new Error(`Unknown startup variable: ${match[1]}`);
    }
    return game.wrapped ? [...original.slice(0, 4), ...override.slice(1)] : [...override];
}
