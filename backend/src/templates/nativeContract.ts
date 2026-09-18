import { TemplateError, templateHash, validateTemplate, validateVariable, type GameTemplate } from './schema.js';
import type { NormalizedPorts } from '../utils/ports.js';

export function nativeTemplate(metadata: Record<string, any>): GameTemplate | null {
    const snapshot = metadata.template;
    if (snapshot?.document?.schemaVersion !== 2) return null;
    const document = validateTemplate(snapshot.document);
    if (templateHash(document) !== snapshot.hash) throw new TemplateError('Stored native template checksum mismatch', 409);
    return document;
}

export function nativeEnvironment(t: GameTemplate, env: string[], ports: NormalizedPorts): Record<string, string> {
    const values: Record<string, string> = Object.create(null);
    const allowed = new Set([...t.variables.map(v => v.key), ...t.ports.filter(p => p.env).map(p => p.env)]);
    for (const entry of env) {
        const split = entry.indexOf('=');
        const key = entry.slice(0, split);
        if (split < 1 || !allowed.has(key) || key in values) throw new TemplateError('Unknown or duplicate native environment variable');
        values[key] = entry.slice(split + 1);
    }
    for (const v of t.variables) values[v.key] = validateVariable(v, values[v.key] ?? v.default);
    // Keep the container-side contract immutable; public host ports can change independently.
    for (const protocol of ['tcp', 'udp'] as const) {
        const declared = t.ports.filter(p => p.protocol === protocol);
        if (ports[protocol].length !== declared.length || declared.some(p => ports[protocol].filter(b => b.container === p.container).length !== 1)) {
            throw new TemplateError('Native container ports must match the installed template');
        }
        for (const p of declared) {
            if (p.env) {
                if (values[p.env] !== String(p.container)) throw new TemplateError(`Do not override managed port variable ${p.env}`);
                values[p.env] = String(p.container);
            }
        }
    }
    return values;
}

export function renderNativeArgv(argv: string[], values: Record<string, string>): string[] {
    // One replacement pass, no shell parsing or recursive interpolation.
    return argv.map(arg => arg.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key) => {
        if (!(key in values)) throw new TemplateError(`Missing command variable: ${key}`);
        return values[key];
    }));
}

export function nativeContainerOptions(t: GameTemplate, env: string[], ports: NormalizedPorts) {
    const lifecycle = t.lifecycle!;
    const identity = t.runtime.identity!;
    return {
        command: renderNativeArgv(lifecycle.startup, nativeEnvironment(t, env, ports)),
        user: `${identity.uid}:${identity.gid}`,
        workdir: lifecycle.workdir,
        stopSignal: lifecycle.stopSignal,
        stopTimeoutSeconds: lifecycle.stopTimeoutSeconds,
    };
}
