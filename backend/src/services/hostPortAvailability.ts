// Modified by Skoczi: conflicts compare protocol, port AND overlapping host address.
import { bindingsConflict, type HostBinding } from '../utils/bindAddresses.js';
import { serverRepository } from '../database/index.js';
import { parseStoredPorts } from '../providers/runtimeConfig.js';
import type { NormalizedPorts } from '../utils/ports.js';
import * as dockerUtils from '../utils/docker.js';

type Protocol = 'tcp' | 'udp';

type HostPortCheckInput = {
    ports: NormalizedPorts;
    excludeServerId?: number;
    excludeContainerIds?: string[];
};

function conflictError(message: string): Error {
    return Object.assign(new Error(message), { statusCode: 409 });
}

function requestedHostPorts(ports: NormalizedPorts): HostBinding[] {
    return [
        ...ports.tcp.map((port) => ({ protocol: 'tcp' as const, hostPort: port.host, hostIp: port.hostIp })),
        ...ports.udp.map((port) => ({ protocol: 'udp' as const, hostPort: port.host, hostIp: port.hostIp })),
    ];
}

function matchesRequestedPort(
    requested: HostBinding[],
    protocol: Protocol,
    hostPort: number,
    hostIp?: string
): boolean {
    return requested.some((port) => bindingsConflict(port, { protocol, hostPort, hostIp }));
}

export async function assertHostPortsAvailableForServer(input: HostPortCheckInput): Promise<void> {
    const requested = requestedHostPorts(input.ports);
    if (requested.length === 0) return;

    const servers = await serverRepository.listAll();
    for (const server of servers) {
        if (server.id === input.excludeServerId) continue;

        const storedPorts = parseStoredPorts(server);
        for (const port of requestedHostPorts(storedPorts)) {
            if (!matchesRequestedPort(requested, port.protocol, port.hostPort, port.hostIp)) continue;

            throw conflictError(
                `${port.protocol.toUpperCase()} binding ${port.hostIp || '*'}:${port.hostPort} overlaps server "${server.name}"`
            );
        }
    }

    const publishedHostPorts = await dockerUtils.listPublishedHostPorts({
        excludeContainerIds: input.excludeContainerIds,
        excludeServerIds: input.excludeServerId ? [input.excludeServerId] : [],
    });

    for (const port of publishedHostPorts) {
        if (!matchesRequestedPort(requested, port.protocol, port.hostPort, port.hostIp)) continue;

        throw conflictError(
            `${port.protocol.toUpperCase()} binding ${port.hostIp || '*'}:${port.hostPort} overlaps Docker container "${port.containerName}"`
        );
    }
}
