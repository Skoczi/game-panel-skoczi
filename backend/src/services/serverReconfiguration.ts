import { assertCpuBinding } from './cpuTopology.js';
import { assertHostPortsAvailableForServer } from './hostPortAvailability.js';
import { enterPortAllocationMutation } from './portAllocationLock.js';
import { serverRepository } from '../database/index.js';
import { nativeTemplate, nativeContainerOptions } from '../templates/nativeContract.js';
import { getOvhcloudServerAdapter } from '../providers/ovhcloud/adapters/registry.js';
import type { NormalizedHealthcheck } from '../utils/healthcheck.js';
import type { NormalizedMount } from '../utils/mounts.js';
import type { NormalizedPorts } from '../utils/ports.js';
import { assertPortPolicy } from '../utils/portPolicy.js';
import type { NormalizedResourceLimits } from '../utils/resourceLimits.js';
import { ensureServerMountDirs, removeServerMountDir } from '../utils/storage.js';
import * as dockerUtils from '../utils/docker.js';
import type { GameServerRow, HealthStatus } from '../types/gameServer.js';
import {
    getRuntimeOwnership,
    parseStoredEnv,
    parseStoredHealthcheck,
    parseStoredMounts,
    parseStoredPorts,
    parseStoredResourceLimits,
} from '../providers/runtimeConfig.js';
import {
    beginServerTransition,
    clearServerTransition,
    completeServerTransition,
    POWER_TRANSITION_TIMEOUT_MS,
} from './serverTransitions.js';
import { getServerOrThrow } from './servers.js';
import {
    getServerRestartPolicy,
    getServerStopTimeoutSeconds,
    recreateOvhcloudServerIfHandled,
} from './ovhcloudLifecycle.js';
import {
    assertCanReconfigureContainer,
    assertCanReconfigureServer,
} from './serverActionPolicy.js';

type ReconfigureInput = {
    applyMode?: 'restart' | 'defer';
    customParams?: string[];
    hasCustomParamsPatch?: boolean;
    startupCommand?: string[] | null;
    hasStartupPatch?: boolean;
    name?: string;
    ports?: NormalizedPorts;
    mounts?: NormalizedMount[];
    env?: string[];
    healthcheck?: NormalizedHealthcheck | null;
    hasHealthcheckPatch?: boolean;
    resourceLimits?: NormalizedResourceLimits;
    hasResourceLimitsPatch?: boolean;
    deleteHostData?: boolean;
};

export type ReconfigureResult = {
    pendingRestart?: boolean;
    reconfigured: boolean;
    wasRunning: boolean;
    usedImage: string;
    usedImageFallback: boolean;
    deletedHostDataKeys: string[];
    hostDataDeletionErrors: Array<{ key: string; error: string }>;
};

export type ResourceLimitsUpdateResult = {
    updated: boolean;
    dockerUpdated: boolean;
    containerStatus: string;
};

function validateEnvForServer(server: GameServerRow, env: string[]): string[] {
    if (server.provider !== 'ovhcloud') return env;
    return getOvhcloudServerAdapter(server).validateEnv?.(server, env) ?? env;
}

async function resolveImageForRecreate(server: GameServerRow): Promise<{
    image: string;
    usedFallback: boolean;
}> {
    const primary = server.docker_image_digest?.trim() || server.docker_image;
    if (await dockerUtils.imageExists(primary)) {
        return { image: primary, usedFallback: false };
    }
    if (nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'))) throw new Error('Pinned native image is missing on this node; restore the same image before recreating this server');

    try {
        await dockerUtils.pullImageByName(primary);
        return { image: primary, usedFallback: false };
    } catch (primaryError) {
        if (primary === server.docker_image) {
            throw primaryError;
        }
    }

    if (!(await dockerUtils.imageExists(server.docker_image))) {
        await dockerUtils.pullImageByName(server.docker_image);
    }

    return { image: server.docker_image, usedFallback: true };
}

async function deleteRemovedMountData(params: {
    serverId: number;
    oldMounts: NormalizedMount[];
    nextMounts: NormalizedMount[];
    enabled: boolean;
}): Promise<{
    deletedHostDataKeys: string[];
    hostDataDeletionErrors: Array<{ key: string; error: string }>;
}> {
    if (!params.enabled) {
        return { deletedHostDataKeys: [], hostDataDeletionErrors: [] };
    }

    const nextKeys = new Set(params.nextMounts.map((mount) => mount.key));
    const removedKeys = [...new Set(params.oldMounts.map((mount) => mount.key))]
        .filter((key) => !nextKeys.has(key));

    const deletedHostDataKeys: string[] = [];
    const hostDataDeletionErrors: Array<{ key: string; error: string }> = [];

    for (const key of removedKeys) {
        try {
            await removeServerMountDir(params.serverId, key);
            deletedHostDataKeys.push(key);
        } catch (error) {
            hostDataDeletionErrors.push({
                key,
                error: error instanceof Error ? error.message : 'Unknown deletion error',
            });
        }
    }

    return { deletedHostDataKeys, hostDataDeletionErrors };
}

async function completeReconfigureStatus(params: {
    serverId: number;
    wasRunning: boolean;
    healthStatus: HealthStatus;
}): Promise<void> {
    if (!params.wasRunning) {
        await completeServerTransition(params.serverId, 'stopped');
        return;
    }

    if (params.healthStatus === 'none' || params.healthStatus === 'healthy') {
        await completeServerTransition(params.serverId, 'running');
        return;
    }

    if (params.healthStatus === 'unhealthy' || params.healthStatus === 'unknown') {
        await completeServerTransition(params.serverId, 'unhealthy');
    }
}

export async function reconfigureServerContainer(
    serverId: number,
    input: ReconfigureInput
): Promise<ReconfigureResult> {
    const server = await getServerOrThrow(serverId);

    assertCanReconfigureServer(server);

    const currentContainerStatus = await dockerUtils.checkContainerStatus(server.docker_container_id);
    assertCanReconfigureContainer(currentContainerStatus);

    const storedMetadata = JSON.parse(server.provider_metadata_json || '{}');
    // Later edits merge into the saved draft, including fields the caller cannot edit.
    input = { ...storedMetadata.pendingConfiguration, ...Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && (!key.startsWith('has') || value === true))) };
    const currentPorts = parseStoredPorts(server);
    const currentMounts = parseStoredMounts(server);
    const currentEnv = parseStoredEnv(server);
    const currentHealthcheck = parseStoredHealthcheck(server);
    const currentResourceLimits = parseStoredResourceLimits(server);

    const nextPorts = input.ports ?? currentPorts;
    for (const protocol of ['tcp', 'udp'] as const) for (const binding of nextPorts[protocol]) {
        const existing = currentPorts[protocol].find(p => p.container === binding.container);
        const assigned = [...currentPorts.tcp, ...currentPorts.udp].map(p => p.hostIp || '0.0.0.0');
        if ((existing && (existing.hostIp || '0.0.0.0') !== (binding.hostIp || '0.0.0.0')) || (!existing && assigned.length && !assigned.includes(binding.hostIp || '0.0.0.0'))) throw Object.assign(new Error('The assigned host IP cannot be changed.'), { statusCode: 400 });
    }
    assertPortPolicy(nextPorts); // Validate before stopping the existing container.
    const nextMounts = input.mounts ?? currentMounts;
    const nextEnv = validateEnvForServer(server, input.env ?? currentEnv);
    const nextHealthcheck = input.hasHealthcheckPatch ? input.healthcheck ?? null : currentHealthcheck;
    const nextResourceLimits = input.hasResourceLimitsPatch ? input.resourceLimits ?? null : currentResourceLimits;
    await assertCpuBinding(nextResourceLimits);
    const metadata = { ...storedMetadata };
    delete metadata.pendingConfiguration;
    const native = nativeTemplate(metadata);
    if (input.hasStartupPatch) {
        if (!native) throw Object.assign(new Error('Startup parameters require a native template.'), { statusCode: 400 });
        metadata.startupCommand = input.startupCommand;
    }
    if (input.hasCustomParamsPatch) {
        if (!native) throw Object.assign(new Error('Custom parameters require a native template.'), { statusCode: 400 });
        metadata.customParams = input.customParams;
    }
    let nativeOptions;
    try { nativeOptions = native ? nativeContainerOptions(native, nextEnv, nextPorts, metadata.startupCommand, metadata.customParams) : undefined; }
    catch (error) { throw Object.assign(error as Error, { statusCode: 400 }); }
    if (native && JSON.stringify(nextMounts) !== JSON.stringify(native.mounts)) throw Object.assign(new Error('Native data mounts are fixed by the installed template'), { statusCode: 400 });

    const wasRunning = currentContainerStatus === 'running' || currentContainerStatus === 'restarting';
    const shouldStopBeforeReconfigure = currentContainerStatus === 'running';
    const displayName = input.name ?? server.name;
    if (input.applyMode === 'defer') {
        if (input.deleteHostData) throw Object.assign(new Error('Host data deletion requires applying changes now.'), { statusCode: 400 });
        await serverRepository.update(serverId, {
            provider_metadata_json: JSON.stringify({ ...storedMetadata, pendingConfiguration: {
                name: displayName, ports: nextPorts, mounts: nextMounts, env: nextEnv,
                healthcheck: nextHealthcheck, hasHealthcheckPatch: true,
                resourceLimits: nextResourceLimits, hasResourceLimitsPatch: true,
                ...(native ? { startupCommand: metadata.startupCommand ?? null, hasStartupPatch: true, customParams: metadata.customParams ?? [], hasCustomParamsPatch: true } : {}),
            } }),
        });
        return { reconfigured: false, pendingRestart: true, wasRunning, usedImage: server.docker_image, usedImageFallback: false, deletedHostDataKeys: [], hostDataDeletionErrors: [] };
    }
    const containerName = displayName === server.name && server.docker_container_name
        ? server.docker_container_name
        : dockerUtils.buildManagedContainerName(serverId, displayName);
    const resolvedMounts = await ensureServerMountDirs(serverId, nextMounts, getRuntimeOwnership(server));
    const image = await resolveImageForRecreate(server);

    if (wasRunning) {
        await beginServerTransition(serverId, 'restarting', {
            timeoutMs: POWER_TRANSITION_TIMEOUT_MS,
            timeoutBehavior: 'reconcile',
            pollDockerHealth: true,
        });
    }

    try {
        if (shouldStopBeforeReconfigure) {
            await dockerUtils.stopContainer(
                server.docker_container_id,
                getServerStopTimeoutSeconds(server)
            );
        }

        const ovhcloudRecreate = await recreateOvhcloudServerIfHandled(server, {
            serverId,
            start: wasRunning,
            containerName,
            image: image.image,
            env: nextEnv,
            mounts: nextMounts,
            ports: nextPorts,
            healthcheck: nextHealthcheck,
            resourceLimits: nextResourceLimits,
        });

        if (ovhcloudRecreate.handled) {
            if (!ovhcloudRecreate.healthStatus) {
                throw new Error('OVHcloud recreate handler did not return health status');
            }

            await serverRepository.update(serverId, {
                provider_metadata_json: JSON.stringify(metadata),
                name: displayName,
                ports_json: JSON.stringify(nextPorts),
                mounts_json: JSON.stringify(nextMounts),
                env_json: JSON.stringify(nextEnv),
                healthcheck_json: nextHealthcheck ? JSON.stringify(nextHealthcheck) : null,
                resource_limits_json: nextResourceLimits ? JSON.stringify(nextResourceLimits) : null,
                desired_state: wasRunning ? 'running' : 'stopped',
            });

            await completeReconfigureStatus({
                serverId,
                wasRunning,
                healthStatus: ovhcloudRecreate.healthStatus,
            });

            const deletion = await deleteRemovedMountData({
                serverId,
                oldMounts: currentMounts,
                nextMounts,
                enabled: Boolean(input.deleteHostData),
            });

            return {
                reconfigured: true,
                wasRunning,
                usedImage: image.image,
                usedImageFallback: image.usedFallback,
                ...deletion,
            };
        }

        await dockerUtils.removeContainer(server.docker_container_id);

        const containerInfo = await dockerUtils.createContainer(
            {
                provider: server.provider,
                catalogId: server.catalog_id,
                image: image.image,
                ...(nativeOptions ? { native: nativeOptions } : {}),
                env: nextEnv,
                mounts: resolvedMounts,
                ports: nextPorts,
                healthcheck: nextHealthcheck,
                resourceLimits: nextResourceLimits,
                restartPolicy: getServerRestartPolicy(server),
                start: wasRunning,
            },
            serverId,
            containerName
        );

        await serverRepository.updateDockerInfo(serverId, containerInfo.id, containerInfo.name);
        await serverRepository.update(serverId, {
            provider_metadata_json: JSON.stringify(metadata),
            name: displayName,
            ports_json: JSON.stringify(nextPorts),
            mounts_json: JSON.stringify(nextMounts),
            env_json: JSON.stringify(nextEnv),
            healthcheck_json: nextHealthcheck ? JSON.stringify(nextHealthcheck) : null,
            resource_limits_json: nextResourceLimits ? JSON.stringify(nextResourceLimits) : null,
            desired_state: wasRunning ? 'running' : 'stopped',
        });

        const runtime = await dockerUtils.inspectContainerRuntime(containerInfo.id);
        await serverRepository.updateRuntimeState(serverId, runtime);
        await completeReconfigureStatus({
            serverId,
            wasRunning,
            healthStatus: runtime.healthStatus,
        });

        const deletion = await deleteRemovedMountData({
            serverId,
            oldMounts: currentMounts,
            nextMounts,
            enabled: Boolean(input.deleteHostData),
        });

        return {
            reconfigured: true,
            wasRunning,
            usedImage: image.image,
            usedImageFallback: image.usedFallback,
            ...deletion,
        };
    } catch (error) {
        clearServerTransition(serverId);

        const message = error instanceof Error ? error.message : 'Unknown reconfiguration error';
        await serverRepository.markFailed(serverId, message).catch(() => undefined);
        throw error;
    }
}

// Called inside the caller's server-mutation lock, before any power transition.
export async function applyPendingServerConfiguration(serverId: number): Promise<ReconfigureResult | null> {
    const server = await getServerOrThrow(serverId);
    const pending = JSON.parse(server.provider_metadata_json || '{}').pendingConfiguration;
    if (!pending) return null;
    const release = enterPortAllocationMutation();
    try {
        await assertHostPortsAvailableForServer({ ports: pending.ports, excludeServerId: serverId, excludeContainerIds: server.docker_container_id ? [server.docker_container_id] : [] });
        return await reconfigureServerContainer(serverId, { applyMode: 'restart' });
    } finally { release(); }
}

export async function updateServerResourceLimits(
    serverId: number,
    resourceLimits: NormalizedResourceLimits
): Promise<ResourceLimitsUpdateResult> {
    const server = await serverRepository.findById(serverId);
    if (!server) {
        throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    }

    await assertCpuBinding(resourceLimits);
    let dockerUpdated = false;
    let containerStatus = 'missing';

    if (server.docker_container_id) {
        containerStatus = await dockerUtils.checkContainerStatus(server.docker_container_id).catch(() => 'missing');

        if (containerStatus !== 'missing' && containerStatus !== 'removing') {
            await dockerUtils.updateContainerResourceLimits(server.docker_container_id, resourceLimits);
            dockerUpdated = true;
        }
    }

    await serverRepository.update(serverId, {
        resource_limits_json: resourceLimits ? JSON.stringify(resourceLimits) : null,
    });

    return {
        updated: true,
        dockerUpdated,
        containerStatus,
    };
}
