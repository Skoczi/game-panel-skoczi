import { configuredPortPolicy } from '../utils/portPolicy.js';
import { bindAddressesOverlap, type HostBinding } from '../utils/bindAddresses.js';
import { globalSettings } from './globalSettings.js';
import { reservedHostBindings } from './hostPortAvailability.js';
import { TemplateError, type GameTemplate } from '../templates/schema.js';
import type { GlobalSettings } from './globalSettingsStore.js';

type Network = GlobalSettings['network'];
type Binding = { key: string; hostIp: string; host: number | 'auto' };

export function availablePublicPorts(network: Network, occupied: HostBinding[], ip: unknown, protocol: unknown): number[] {
    if (typeof ip !== 'string' || (protocol !== 'tcp' && protocol !== 'udp')) throw new TemplateError('Select an allocated IP and TCP or UDP');
    // New template installs use explicit pools even when legacy unrestricted installs are enabled.
    const allocation = network.allocations.find(a => a.ip === ip);
    if (!allocation) throw new TemplateError('This IP is not allocated to this node');
    const ranges = configuredPortPolicy(JSON.stringify({ [ip]: { tcp: allocation.tcp, udp: allocation.udp } }))![ip][protocol];
    const busy = new Set(occupied.filter(b => b.protocol === protocol && bindAddressesOverlap(b.hostIp, ip)).map(b => b.hostPort));
    const free = new Set<number>();
    for (const range of ranges) for (let port = range.from; port <= range.to; port++) if (!busy.has(port)) free.add(port);
    return [...free].sort((a, b) => a - b);
}

export async function listAvailablePublicPorts(ip: unknown, protocol: unknown): Promise<number[]> {
    const occupied = await reservedHostBindings();
    return availablePublicPorts(globalSettings().snapshot().network, occupied, ip, protocol);
}

export function chooseTemplateBindings(template: GameTemplate, input: unknown, network: Network, occupied: HostBinding[]): Array<Omit<Binding, 'host'> & { host: number }> {
    if (!Array.isArray(input) || input.length !== template.ports.length) throw new TemplateError('Each template port needs exactly one binding');
    const selected = template.ports.map(p => {
        const matches = input.filter(b => b?.key === p.key);
        if (matches.length !== 1 || typeof matches[0].hostIp !== 'string' || (matches[0].host !== 'auto' && !Number.isInteger(matches[0].host))) throw new TemplateError('Invalid template binding');
        return { key: p.key, hostIp: matches[0].hostIp, host: matches[0].host } as Binding;
    });
    const claimed = [...occupied];
    // Manual selections first: automatic assignment must not steal another field's explicit port.
    for (const automatic of [false, true]) for (let i = 0; i < selected.length; i++) {
        const b = selected[i];
        if ((b.host === 'auto') !== automatic) continue;
        const protocol = template.ports[i].protocol;
        if (typeof b.host === 'number' && !availablePublicPorts(network, [], b.hostIp, protocol).includes(b.host)) {
            throw new TemplateError(`Port ${b.host}/${protocol} is outside the allocated pool for ${b.hostIp}`);
        }
        const free = availablePublicPorts(network, claimed, b.hostIp, protocol);
        const host = b.host === 'auto' ? free[0] : b.host;
        if (!host || !free.includes(host)) throw new TemplateError(`No available ${protocol.toUpperCase()} allocation for ${b.hostIp}${b.host === 'auto' ? '' : `:${b.host}`}. Refresh available ports.`, 409);
        b.host = host;
        claimed.push({ protocol, hostIp: b.hostIp, hostPort: host });
    }
    return selected as Array<Omit<Binding, 'host'> & { host: number }>;
}

// Caller holds the node's allocation mutation lock until game_servers persists the claim.
export async function resolveTemplateBindings(template: GameTemplate, input: unknown) {
    const occupied = await reservedHostBindings();
    return chooseTemplateBindings(template, input, globalSettings().snapshot().network, occupied);
}
