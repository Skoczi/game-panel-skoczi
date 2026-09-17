// Skoczi fork: pure Docker binding builder, shared by runtime and regression tests.
import type { NormalizedPorts } from '../ports.js';
import { assertPortPolicy } from '../portPolicy.js';

export function buildPortMaps(ports: NormalizedPorts) {
    assertPortPolicy(ports);
    const exposedPorts: Record<string, {}> = {};
    const portBindings: Record<string, Array<{ HostPort: string; HostIp?: string }>> = {};
    for (const protocol of ['tcp', 'udp'] as const) {
        for (const mapping of ports[protocol]) {
            const key = `${mapping.container}/${protocol}`;
            exposedPorts[key] = {};
            (portBindings[key] ??= []).push({
                HostPort: String(mapping.host),
                ...(mapping.hostIp ? { HostIp: mapping.hostIp } : {}),
            });
        }
    }
    return { exposedPorts, portBindings };
}
