import { docker } from './client.js';
import { ownsContainer, runtimeLabels, runtimeNodeId, NODE_LABEL } from './ownership.js';
import { getConfig } from '../../config.js';
import { logError, logInfo, logWarn } from '../logger.js';

const SERVER_ID_LABEL = 'gamepanel.serverId';

export function buildServerNetworkAlias(serverId: number): string {
    return `gamepanel-server-${serverId}`;
}

async function findNetworkByName(name: string) {
    const networks = await docker.listNetworks({ filters: { name: [name] } });
    return networks.find((network) => network.Name === name) ?? null;
}

export async function ensureGamesNetwork(): Promise<string | null> {
    const { gamesNetwork } = getConfig();

    const existing = await findNetworkByName(gamesNetwork);
    if (existing) {
        if (runtimeNodeId() && existing.Labels?.[NODE_LABEL] !== runtimeNodeId()) throw new Error('Game network belongs to another runtime');
        return existing.Id;
    }

    try {
        const created = await docker.createNetwork({
            Name: gamesNetwork,
            Driver: 'bridge',
            Labels: { 'gamepanel.managed': 'true', ...runtimeLabels() },
        });
        logInfo('DOCKER:NETWORK', `Created network ${gamesNetwork}`);
        return created.id;
    } catch (error) {
        const raced = await findNetworkByName(gamesNetwork);
        if (raced && (!runtimeNodeId() || raced.Labels?.[NODE_LABEL] === runtimeNodeId())) return raced.Id;

        logError('DOCKER:NETWORK:ENSURE', error, { network: gamesNetwork });
        return null;
    }
}

async function attachServerContainers(networkName: string, networkId: string): Promise<void> {
    const containers = await docker.listContainers({
        all: true,
        filters: { label: [SERVER_ID_LABEL] },
    });

    for (const container of containers) {
        if (!ownsContainer(container.Labels)) continue;
        const serverId = Number(container.Labels?.[SERVER_ID_LABEL]);
        if (!Number.isInteger(serverId) || serverId <= 0) continue;

        const endpoint = container.NetworkSettings?.Networks?.[networkName];
        if (endpoint && (endpoint.NetworkID === networkId || endpoint.NetworkID === '')) continue;

        try {
            await docker.getNetwork(networkId).connect({
                Container: container.Id,
                EndpointConfig: { Aliases: [buildServerNetworkAlias(serverId)] },
            });
            logInfo('DOCKER:NETWORK', `Attached server ${serverId} to ${networkName}`);
        } catch (error) {
            logError('DOCKER:NETWORK:ATTACH', error, { serverId, network: networkName });
        }
    }
}

async function warnIfBackendNotAttached(networkName: string, projectName: string): Promise<void> {
    const containers = await docker.listContainers({
        filters: {
            label: [
                `com.docker.compose.project=${projectName}`,
                'com.docker.compose.service=backend',
            ],
        },
    });

    const self = containers[0];
    if (!self) return;
    if (self.NetworkSettings?.Networks?.[networkName]) return;

    logWarn(
        'DOCKER:NETWORK',
        `The backend container is not attached to ${networkName}: features that reach game servers `
        + 'over the network cannot work. The compose file may not declare it (deploy migration).'
    );
}

async function removeLegacyWebNetwork(projectName: string): Promise<void> {
    const legacyName = `${projectName}_web`;

    const legacy = await findNetworkByName(legacyName);
    if (!legacy) return;

    try {
        await docker.getNetwork(legacy.Id).remove();
        logInfo('DOCKER:NETWORK', `Removed the legacy ${legacyName} network`);
    } catch {
        // Still carrying endpoints, or already gone: nothing to repair.
    }
}

export async function reconcileGamesNetwork(): Promise<void> {
    const { gamesNetwork, composeProjectName } = getConfig();

    const networkId = await ensureGamesNetwork();
    if (!networkId) return;

    await attachServerContainers(gamesNetwork, networkId);
    await warnIfBackendNotAttached(gamesNetwork, composeProjectName);
    await removeLegacyWebNetwork(composeProjectName);
}
