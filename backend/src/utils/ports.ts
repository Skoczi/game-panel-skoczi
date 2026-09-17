// Modified by Skoczi: IPv4 allocations, address-aware conflicts and strict port parsing.
import { normalizeBindAddress, bindAddressesOverlap } from './bindAddresses.js';
/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PortsPayload = {
    tcp?: Array<{ host?: unknown; container?: unknown; label?: unknown; hostIp?: unknown }>;
    udp?: Array<{ host?: unknown; container?: unknown; label?: unknown; hostIp?: unknown }>;
};

export type NormalizedPorts = {
    tcp: Array<{ host: number; container: number; label: string; hostIp?: string }>;
    udp: Array<{ host: number; container: number; label: string; hostIp?: string }>;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toInt(v: unknown): number | null {
    if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+$/.test(v))) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
}

function normalizeEntries(
    entries: PortsPayload['tcp']
): NormalizedPorts['tcp'] {
    if (!entries) return [];
    if (!Array.isArray(entries)) throw new Error('Invalid ports payload (protocol values must be arrays)');

    const out: NormalizedPorts['tcp'] = [];

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Invalid ports payload (entries must be objects)');
        }

        const host = toInt(entry.host);
        const container = toInt(entry.container);

        if (host === null || container === null) {
            throw new Error('Invalid ports payload (must be integers)');
        }

        out.push({
            host,
            container,
            label: String(entry.label ?? ''),
            hostIp: normalizeBindAddress(entry.hostIp),
        });
    }

    return out;
}

function validatePortRangePairs(ports: Array<{ container: number; host: number }>, label: string) {
    for (const m of ports) {
        if (!isValidPort(m.container)) throw new Error(`${label}: invalid container port ${m.container}`);
        if (!isValidPort(m.host)) throw new Error(`${label}: invalid host port ${m.host}`);
    }
}

function assertNoDuplicateHostPorts(ports: NormalizedPorts['tcp'], label: string) {
    for (let index = 0; index < ports.length; index++) {
        if (ports.slice(0, index).some((other) => other.host === ports[index].host && bindAddressesOverlap(other.hostIp, ports[index].hostIp))) {
            throw new Error(`Overlapping ${label} host IP/port bindings in mapping`);
        }
    }
}

function isValidPort(p: number): boolean {
    return Number.isInteger(p) && p >= 1 && p <= 65535;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function buildAndValidateOpenPortMappings(params: {
    portsPayload?: PortsPayload | null;
}): { ports: NormalizedPorts } {
    const { portsPayload } = params;

    if (!portsPayload || (portsPayload.tcp === undefined && portsPayload.udp === undefined)) {
        return { ports: { tcp: [], udp: [] } };
    }

    const tcp = normalizeEntries(portsPayload.tcp);
    const udp = normalizeEntries(portsPayload.udp);

    // Ensure ports are valid (1..65535) on BOTH sides
    validatePortRangePairs(tcp, 'TCP');
    validatePortRangePairs(udp, 'UDP');

    // Ensure no duplicate host ports within same proto
    assertNoDuplicateHostPorts(tcp, 'TCP');
    assertNoDuplicateHostPorts(udp, 'UDP');

    return { ports: { tcp, udp } };
}

export function assertHostPortsAbove1024(hostPorts: { tcp: number[]; udp: number[] }): void {
    const all = [...hostPorts.tcp, ...hostPorts.udp];
    const bad = all.filter((p) => p <= 1024);
    if (bad.length) {
        throw new Error(`Host ports must be > 1024 (invalid: ${[...new Set(bad)].join(', ')})`);
    }
}

export function collectHostPortsByProto(ports: NormalizedPorts): { tcp: number[]; udp: number[] } {
    return {
        tcp: ports.tcp.map((m) => m.host),
        udp: ports.udp.map((m) => m.host),
    };
}
