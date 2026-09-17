// Skoczi: administrator-managed host port allocations. This does not configure a firewall.
import { isIPv4 } from 'node:net';

export type PortRange = { from: number; to: number };
export type IpPortPolicy = Record<string, { tcp: PortRange[]; udp: PortRange[] }>;

export function isUnicastIPv4(value: string): boolean {
    return isIPv4(value) && value !== '0.0.0.0' && Number(value.split('.')[0]) < 224;
}

function parseRanges(value: unknown): PortRange[] {
    if (value === undefined || value === '') return [];
    if (typeof value !== 'string') throw new Error('Port ranges must be strings, e.g. "27015-27030,28015"');
    return value.split(',').map((part) => {
        const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim());
        if (!match) throw new Error(`Invalid port range: ${part}`);
        const from = Number(match[1]);
        const to = Number(match[2] ?? match[1]);
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1025 || to > 65535 || from > to) {
            throw new Error('Host port ranges must be within 1025-65535, with start <= end');
        }
        return { from, to };
    });
}

export function configuredPortPolicy(raw = process.env.GAMEPANEL_IP_PORTS ?? ''): IpPortPolicy | null {
    if (!raw.trim()) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('GAMEPANEL_IP_PORTS must be a JSON object'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('GAMEPANEL_IP_PORTS must be a JSON object');
    const result: IpPortPolicy = {};
    for (const [ip, protocols] of Object.entries(parsed)) {
        if (!isUnicastIPv4(ip)) throw new Error(`Invalid GAMEPANEL_IP_PORTS IPv4: ${ip}`);
        if (!protocols || typeof protocols !== 'object' || Array.isArray(protocols) ||
            Object.keys(protocols).some((key) => key !== 'tcp' && key !== 'udp')) {
            throw new Error(`Port policy for ${ip} must contain only tcp and/or udp`);
        }
        const values = protocols as Record<string, unknown>;
        result[ip] = { tcp: parseRanges(values.tcp), udp: parseRanges(values.udp) };
    }
    return result;
}

export function assertPortPolicy(ports: { tcp: Array<{ host: number; hostIp?: string }>; udp: Array<{ host: number; hostIp?: string }> }, policy = configuredPortPolicy()): void {
    if (policy === null) return;
    for (const protocol of ['tcp', 'udp'] as const) {
        for (const port of ports[protocol]) {
            if (!port.hostIp || !Object.prototype.hasOwnProperty.call(policy, port.hostIp)) throw new Error('Choose an explicitly configured host IPv4 for every port');
            if (!Number.isInteger(port.host) || !policy[port.hostIp][protocol].some(({ from, to }) => port.host >= from && port.host <= to)) {
                throw new Error(`${protocol.toUpperCase()} host port ${port.host} is not allowed on ${port.hostIp}`);
            }
        }
    }
}
