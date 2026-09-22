import { serverRepository } from '../database/index.js';
import * as dockerUtils from '../utils/docker.js';
import { applyPendingServerConfiguration } from './serverReconfiguration.js';
import { assertHostPortsAvailableForServer } from './hostPortAvailability.js';
import { getServerStopTimeoutSeconds, restartOvhcloudServerIfHandled } from './ovhcloudLifecycle.js';
import { parseStoredPorts } from '../providers/runtimeConfig.js';
import { beginServerTransition, POWER_TRANSITION_TIMEOUT_MS, RESTART_HEALTH_POLL_DELAY_MS } from './serverTransitions.js';
import { assertCanPowerServer } from './serverActionPolicy.js';
import { completeDockerPowerTransition } from '../routes/servers/shared.js';
async function load(id: number) {
    const server = await serverRepository.findById(id);
    if (!server) throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    assertCanPowerServer(server);
    if (!server.docker_container_id) throw Object.assign(new Error('Server has no container'), { statusCode: 400 });
    return { ...server, docker_container_id: server.docker_container_id };
}
// Caller holds the shared mutation lock, for both HTTP and automatic recovery.
export async function restartServer(serverId: number, applyPending = true) {
    let server = await load(serverId);
    const applied = applyPending ? await applyPendingServerConfiguration(serverId) : null;
    if (applied?.wasRunning) {
        return true;
    }
    if (applied) server = await load(serverId);
    const currentStatus = await dockerUtils.checkContainerStatus(server.docker_container_id);
    if (currentStatus !== 'running') await assertHostPortsAvailableForServer({ ports: parseStoredPorts(server), excludeServerId: serverId, excludeContainerIds: [server.docker_container_id] });
    await serverRepository.updateDesiredState(serverId, 'running');
    await beginServerTransition(serverId, 'restarting', { timeoutMs: POWER_TRANSITION_TIMEOUT_MS, timeoutBehavior: 'reconcile', pollDockerHealth: true, healthPollDelayMs: RESTART_HEALTH_POLL_DELAY_MS });
    const handled = await restartOvhcloudServerIfHandled(serverId, server);
    if (!handled && currentStatus === 'running') await dockerUtils.restartContainer(server.docker_container_id, getServerStopTimeoutSeconds(server));
    else if (!handled) await dockerUtils.startContainer(server.docker_container_id);
    await completeDockerPowerTransition(serverId);
    return false;
}
