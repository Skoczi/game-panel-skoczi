import jwt from 'jsonwebtoken';
import { isIP } from 'node:net';
import { TemplateError, templateHash, validateTemplate, validateVariable, type GameTemplate } from './schema.js';
export type TemplateSnapshot = { id: string; version: number; hash: string; document: GameTemplate };
export function issueTemplateTicket(snapshot: TemplateSnapshot, key: string, nodeId: string): string {
    return jwt.sign({ snapshot, protocol: 1 }, key, { algorithm: 'HS256', issuer: 'gamepanel-templates', audience: nodeId, expiresIn: 120 });
}
export function readTemplateTicket(ticket: unknown, key: string, nodeId: string): TemplateSnapshot {
    try {
        if (typeof ticket !== 'string' || ticket.length > 65536) throw new Error();
        const claims = jwt.verify(ticket, key, { algorithms: ['HS256'], issuer: 'gamepanel-templates', audience: nodeId }) as jwt.JwtPayload;
        const s = claims.snapshot;
        if (claims.protocol !== 1 || !s || typeof s.id !== 'string' || !Number.isSafeInteger(s.version) || s.version < 1) throw new Error();
        const document = validateTemplate(s.document);
        if (s.hash !== templateHash(document)) throw new Error();
        return { id: s.id, version: s.version, hash: s.hash, document };
    } catch { throw new TemplateError('Invalid or expired template authorization. Prepare the installation again.', 409); }
}
export function materializeTemplate(s: TemplateSnapshot, input: Record<string, any>, architecture = process.arch): Record<string, any> {
    const t = s.document;
    if (!t.runtime.architectures.includes(architecture as 'x64' | 'arm64')) throw new TemplateError('Template does not support this node architecture');
    const bindings = input.bindings;
    const values = input.variables ?? {};
    if (!Array.isArray(bindings) || bindings.length !== t.ports.length || !values || typeof values !== 'object' || Array.isArray(values)) throw new TemplateError('Invalid template bindings or variables');
    if (Object.keys(values).some(k => !t.variables.some(v => v.key === k))) throw new TemplateError('Unknown template variable');
    const env: Record<string, string> = Object.create(null);
    for (const v of t.variables) env[v.key] = validateVariable(v, values[v.key] ?? v.default);
    const ports: { tcp: any[]; udp: any[] } = { tcp: [], udp: [] };
    const linuxgsmConfig: Record<string, string> = Object.create(null);
    for (const p of t.ports) {
        const matches = bindings.filter((b: any) => b?.key === p.key);
        if (matches.length !== 1) throw new TemplateError('Each template port needs exactly one binding');
        const b = matches[0];
        if (!Number.isInteger(b.host) || b.host < 1025 || b.host > 65535 || typeof b.hostIp !== 'string' || isIP(b.hostIp) !== 4 || b.hostIp === '0.0.0.0') throw new TemplateError('Select an explicit IPv4 address and a valid host port');
        ports[p.protocol].push({ host: b.host, container: p.container, hostIp: b.hostIp, label: p.label });
        if (p.env) env[p.env] = String(p.container);
        if (p.linuxgsmKey) linuxgsmConfig[p.linuxgsmKey] = String(p.container);
    }
    return {
        name: input.name, resourceLimits: input.resourceLimits,
        provider: t.runtime.provider, shortname: t.runtime.catalogId, imageId: t.runtime.catalogId,
        dockerImage: t.runtime.image, mounts: t.mounts, env, ports, runtimeIdentity: t.runtime.identity,
        // These internal fields are regenerated from the verified ticket, never trusted from JSON.
        templateSnapshot: s, templateLinuxgsmConfig: linuxgsmConfig,
    };
}
