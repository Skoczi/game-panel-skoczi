// Versioned templates. Native commands are reviewed and published by root administrators.
import { createHash } from 'node:crypto';
import type { GameTemplate } from './types.js';
export type { GameTemplate } from './types.js';
export class TemplateError extends Error {
    constructor(message: string, public statusCode = 400) { super(message); }
}
function object(value: unknown, keys: string[]): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TemplateError('Expected an object');
    if (Object.keys(value).some(k => !keys.includes(k))) throw new TemplateError('Unsupported template field');
    return value as Record<string, any>;
}
function text(value: unknown, max: number, empty = false): string {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\x00-\x08\x0b-\x1f]/.test(value)) throw new TemplateError('Invalid or missing text field');
    return value;
}
function list(value: unknown, max: number): any[] {
    if (!Array.isArray(value) || value.length > max) throw new TemplateError('Invalid list or too many entries');
    return value;
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
    if (!values.includes(value as T)) throw new TemplateError(`Expected ${values.join(', ')}`);
    return value as T;
}
function identifier(value: unknown, empty = false): string {
    const s = text(value, 64, empty);
    if (s === '' && empty) return s;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s) || ['__proto__', 'constructor', 'prototype'].includes(s)) throw new TemplateError('Invalid field key');
    return s;
}
function port(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1025 || Number(value) > 65535) throw new TemplateError('Ports must be integers between 1025 and 65535');
    return Number(value);
}
function unique(values: string[]) {
    if (new Set(values).size !== values.length) throw new TemplateError('Duplicate keys or port bindings');
}
export function validateTemplate(input: unknown): GameTemplate {
    if (JSON.stringify(input)?.length > 32768) throw new TemplateError('Template exceeds 32 KiB');
    const v = object(input, ['schemaVersion', 'name', 'description', 'author', 'source', 'runtime', 'ports', 'variables', 'mounts', 'lifecycle', 'configFiles']);
    if (v.schemaVersion !== 1 && v.schemaVersion !== 2) throw new TemplateError('Unsupported template schema (expected 1 or 2; egg files require conversion)');
    if (v.schemaVersion === 1 && v.lifecycle !== undefined) throw new TemplateError('Native lifecycle requires schemaVersion 2');
    const r = object(v.runtime, ['provider', 'image', 'catalogId', 'gameServerName', 'architectures', 'identity']);
    const provider = choice(r.provider, ['linuxgsm', 'ovhcloud', 'external']);
    const image = text(r.image, 255);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new TemplateError('Invalid Docker image');
    const catalogId = text(r.catalogId, 128, provider === 'external');
    const gameServerName = text(r.gameServerName, 64, provider !== 'linuxgsm');
    if (catalogId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(catalogId)) throw new TemplateError('Invalid catalog ID');
    if (gameServerName && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(gameServerName)) throw new TemplateError('Invalid game server name');
    const architectures = list(r.architectures, 2).map(a => choice(a, ['x64', 'arm64'] as const));
    if (!architectures.length) throw new TemplateError('Select a supported architecture');
    unique(architectures);
    let identity: GameTemplate['runtime']['identity'];
    if (provider === 'external') {
        const i = object(r.identity, ['user', 'uid', 'gid']);
        const user = text(i.user, 64);
        if (!/^(?:[a-z_][a-z0-9_-]*|[1-9][0-9]*)$/.test(user) || user === 'root' || !Number.isInteger(i.uid) || i.uid < 1 || i.uid > 2147483647 || !Number.isInteger(i.gid) || i.gid < 1 || i.gid > 2147483647) throw new TemplateError('External images require a non-root runtime user and positive UID/GID');
        identity = { user, uid: i.uid, gid: i.gid };
    }
    const ports = list(v.ports, 16).map(raw => {
        const p = object(raw, ['key', 'label', 'protocol', 'container', 'suggested', 'env', 'linuxgsmKey']);
        const result = { key: identifier(p.key), label: text(p.label, 80), protocol: choice(p.protocol, ['tcp', 'udp']), container: port(p.container), suggested: port(p.suggested), env: identifier(p.env, true), linuxgsmKey: identifier(p.linuxgsmKey, true) };
        if (result.linuxgsmKey && provider !== 'linuxgsm') throw new TemplateError('LinuxGSM port keys require the LinuxGSM provider');
        return result;
    });
    unique(ports.map(p => p.key)); unique(ports.map(p => `${p.protocol}:${p.container}`));
    unique(ports.filter(p => p.env).map(p => p.env)); unique(ports.filter(p => p.linuxgsmKey).map(p => p.linuxgsmKey));
    const variables = list(v.variables, 48).map(raw => {
        const p = object(raw, ['key', 'label', 'type', 'required', 'secret', 'default']);
        if (typeof p.required !== 'boolean' || typeof p.secret !== 'boolean') throw new TemplateError('Variable flags must be booleans');
        const result = { key: identifier(p.key), label: text(p.label, 80), type: choice(p.type, ['string', 'integer', 'boolean']), required: p.required, secret: p.secret, default: text(p.default, 2048, true) };
        if (result.secret && result.default) throw new TemplateError('Secret defaults must be empty; enter credentials only when installing');
        if (/password|secret|token|credential|api_?key/i.test(result.key) && !result.secret) throw new TemplateError('Credential variables must be marked secret');
        if (result.default) validateVariable(result, result.default);
        return result;
    });
    unique([...variables.map(v => v.key), ...ports.filter(p => p.env).map(p => p.env)]);
    const mounts = list(v.mounts, 12).map(raw => {
        const m = object(raw, ['key', 'containerPath']);
        const containerPath = text(m.containerPath, 160);
        if (!/^\/(?:[a-zA-Z0-9_-]+\/?)+$/.test(containerPath) || /^\/(?:proc|sys|dev|etc|run|var)(?:\/|$)/.test(containerPath)) throw new TemplateError('Use a data directory inside the container; host/system paths are not accepted');
        return { key: identifier(m.key), containerPath: containerPath.replace(/\/$/, '') };
    });
    unique(mounts.map(m => m.key)); unique(mounts.map(m => m.containerPath));
    let configFiles: GameTemplate['configFiles'];
    if (v.configFiles !== undefined) {
        if (v.schemaVersion !== 2) throw new TemplateError('Configuration file links require a native template');
        configFiles = list(v.configFiles, 32).map(raw => {
            const file = object(raw, ['root', 'path', 'label']);
            const root = identifier(file.root);
            const filePath = text(file.path, 300);
            if (!mounts.some(m => m.key === root) || !filePath.startsWith('/') || filePath.includes('\\') || filePath.split('/').some(p => p === '..' || p === '.') || filePath.endsWith('/')) throw new TemplateError('Configuration paths must name a file inside a declared data mount');
            return { root, path: filePath, label: text(file.label, 80) };
        });
        unique(configFiles.map(f => `${f.root}:${f.path}`));
    }
    let lifecycle: GameTemplate['lifecycle'];
    if (v.schemaVersion === 2) {
        if (provider !== 'external') throw new TemplateError('Native lifecycle requires the generic runtime provider, not a legacy adapter');
        const l = object(v.lifecycle, ['startup', 'install', 'update', 'workdir', 'stopSignal', 'stopTimeoutSeconds', 'installerImage']);
        let installerImage: string | undefined;
        if (l.installerImage !== undefined) {
            installerImage = text(l.installerImage, 255);
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(installerImage)) throw new TemplateError('Invalid installer Docker image');
        }
        const keys = new Set([...variables.map(v => v.key), ...ports.filter(p => p.env).map(p => p.env)]);
        const argv = (raw: unknown): string[] => {
            const args = list(raw, 64).map(arg => text(arg, 2048, true));
            if (!args.length || !/^\/[a-zA-Z0-9_./-]+$/.test(args[0]) || args[0].split('/').includes('..')) throw new TemplateError('Command must start with a fixed absolute executable path');
            for (const arg of args) {
                const remainder = arg.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key) => {
                    if (!keys.has(key)) throw new TemplateError(`Unknown command variable: ${key}`);
                    if (variables.some(v => v.key === key && v.secret)) throw new TemplateError('Secret variables may be passed through the environment, not command arguments');
                    return '';
                });
                if (/[{}]/.test(remainder)) throw new TemplateError('Use {{VARIABLE}} placeholders in command arguments');
            }
            return args;
        };
        const bounded = (n: unknown, max: number) => {
            if (!Number.isInteger(n) || Number(n) < 1 || Number(n) > max) throw new TemplateError(`Timeout must be 1–${max} seconds`);
            return Number(n);
        };
        const steps = (raw: unknown): NonNullable<GameTemplate['lifecycle']>['install'] => list(raw, 8).map(s => {
            const step = object(s, ['name', 'argv', 'script', 'timeoutSeconds']);
            const base = { name: text(step.name, 80), timeoutSeconds: bounded(step.timeoutSeconds, 3600) };
            if (step.script !== undefined) {
                if (step.argv !== undefined) throw new TemplateError('Choose either script or command arguments for a step');
                const script = text(step.script, 16384);
                if (Buffer.byteLength(script, 'utf8') > 16384) throw new TemplateError('Script exceeds 16 KiB');
                if (script.includes('\r')) throw new TemplateError('Use LF line endings in scripts');
                if (variables.some(v => /^(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|PATH|LD_.*)$/.test(v.key))) throw new TemplateError('Script templates cannot override shell or loader environment controls');
                // Script source is immutable administrator code. Never interpolate user values into it.
                return { name: base.name, script, timeoutSeconds: base.timeoutSeconds };
            }
            // Preserve legacy canonical key order: stored schema-2 snapshots are hash-checked.
            return { name: base.name, argv: argv(step.argv), timeoutSeconds: base.timeoutSeconds };
        });
        const workdir = text(l.workdir, 160);
        if (!mounts.some(m => m.containerPath === workdir)) throw new TemplateError('Native working directory must be a declared data mount');
        lifecycle = { startup: argv(l.startup), install: steps(l.install), update: steps(l.update), workdir, stopSignal: choice(l.stopSignal, ['SIGTERM', 'SIGINT']), stopTimeoutSeconds: bounded(l.stopTimeoutSeconds, 120), ...(installerImage ? { installerImage } : {}) };
    }
    return { schemaVersion: v.schemaVersion, name: text(v.name, 80), description: text(v.description, 1000, true), author: text(v.author, 100), source: text(v.source, 300, true), runtime: { provider, image, catalogId, gameServerName, architectures, ...(identity ? { identity } : {}) }, ports, variables, mounts, ...(lifecycle ? { lifecycle } : {}), ...(configFiles !== undefined ? { configFiles } : {}) };
}
export function validateVariable(v: GameTemplate['variables'][number], value: unknown): string {
    const s = text(value, 2048, !v.required);
    if (s && v.type === 'integer' && !/^-?\d{1,12}$/.test(s)) throw new TemplateError(`${v.label}: expected an integer`);
    if (s && v.type === 'boolean' && !['true', 'false'].includes(s)) throw new TemplateError(`${v.label}: expected true or false`);
    return s;
}
export const templateHash = (t: GameTemplate) => createHash('sha256').update(JSON.stringify(t)).digest('hex');
export const CS16_TEMPLATE: GameTemplate = {
    schemaVersion: 1, name: 'Counter-Strike 1.6', description: 'Dedicated GoldSrc server. Game, query and RCON share one UDP port. No client-port publication.', author: 'Skoczi', source: 'LinuxGSM / GameServerManagers; network profile maintained by Skoczi',
    runtime: { provider: 'linuxgsm', image: 'gameservermanagers/gameserver:cs', catalogId: 'cs', gameServerName: 'csserver', architectures: ['x64'] },
    ports: [{ key: 'game', label: 'Game / Query / RCON', protocol: 'udp', container: 27015, suggested: 27015, env: '', linuxgsmKey: 'port' }],
    variables: [], mounts: [{ key: 'data', containerPath: '/data' }, { key: 'backup', containerPath: '/app/lgsm/backup' }],
};
