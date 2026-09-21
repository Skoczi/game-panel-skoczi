import { serverRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { parseStoredResourceLimits } from '../utils/resourceLimits.js';
import { readCpuTopology, parseCpuList } from './cpuTopology.js';

export async function availableCpus() {
    const [topology, servers, containers, engine] = await Promise.all([readCpuTopology(), serverRepository.listAll(), docker.listContainers({ all: true }), docker.info()]);
    if (engine.NCPU !== topology.availableCpuIds.length) throw Object.assign(new Error('Docker CPU topology does not match this node'), { statusCode: 503 });
    const inspected = await Promise.all(containers.map(async c => {
        try { return await docker.getContainer(c.Id).inspect(); }
        catch (error) { if ((error as any).statusCode === 404) return null; throw error; }
    }));
    const assignments: Array<{ serverId: number | null; containerId: string | null; name: string; source: string; state: string; configuredCpuSet: number[]; effectiveCpuSet: number[]; pendingCpuSet: number[] | null }> = servers.map(server => {
        const actual = inspected.find(c => c?.Id === server.docker_container_id);
        const pending = JSON.parse(server.provider_metadata_json || '{}').pendingConfiguration;
        return { serverId: server.id, containerId: actual?.Id ?? null, name: server.name, source: 'panel', state: actual?.State.Status ?? 'missing',
            configuredCpuSet: parseStoredResourceLimits(server)?.cpuSet ?? [],
            effectiveCpuSet: actual ? parseCpuList(actual.HostConfig.CpusetCpus || '') : [],
            pendingCpuSet: pending?.hasResourceLimitsPatch ? pending.resourceLimits?.cpuSet ?? [] : null };
    });
    for (const actual of inspected) {
        if (!actual || servers.some(s => s.docker_container_id === actual.Id)) continue;
        assignments.push({ serverId: null, containerId: actual.Id, name: actual.Name.replace(/^\//, ''), source: 'external', state: actual.State.Status,
            configuredCpuSet: parseCpuList(actual.HostConfig.CpusetCpus || ''), effectiveCpuSet: parseCpuList(actual.HostConfig.CpusetCpus || ''), pendingCpuSet: null });
    }
    return { ...topology, assignments, unboundContainerCount: assignments.filter(a => a.state === 'running' && !a.effectiveCpuSet.length).length };
}
