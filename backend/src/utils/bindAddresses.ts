// Skoczi fork: explicit, operator-managed IPv4 allocations. No host network mutations.
import { isIPv4 } from 'node:net';

export function configuredBindAddresses(raw = process.env.GAMEPANEL_BIND_IPS ?? ''): string[] {
    if (!raw.trim()) return [];
    const addresses = raw.split(',').map((address) => address.trim());
    if (addresses.some((address) => !isIPv4(address) || address === '0.0.0.0' || Number(address.split('.')[0]) >= 224)) {
        throw new Error('GAMEPANEL_BIND_IPS must contain comma-separated unicast IPv4 addresses (no wildcards or CIDRs)');
    }
    return [...new Set(addresses)];
}

export function normalizeBindAddress(value: unknown): string | undefined {
    if (value === undefined || value === '') return undefined; // Legacy Docker default, not a concrete allocation.
    if (typeof value !== 'string' || !isIPv4(value.trim())) throw new Error('hostIp must be an allowed IPv4 address');
    const address = value.trim();
    if (!configuredBindAddresses().includes(address)) throw new Error(`hostIp ${address} is not in GAMEPANEL_BIND_IPS`);
    return address;
}

export function bindAddressesOverlap(a?: string, b?: string): boolean {
    const wildcard = (ip?: string) => !ip || ip === '0.0.0.0' || ip === '::' || ip.startsWith('::ffff:');
    // Be conservative for dual-stack/mapped Docker bindings.
    return wildcard(a) || wildcard(b) || a === b;
}

export type HostBinding = { protocol: 'tcp' | 'udp'; hostPort: number; hostIp?: string };
export function bindingsConflict(a: HostBinding, b: HostBinding): boolean {
    return a.protocol === b.protocol && a.hostPort === b.hostPort && bindAddressesOverlap(a.hostIp, b.hostIp);
}
