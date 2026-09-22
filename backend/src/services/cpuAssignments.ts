import { serverRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { parseStoredResourceLimits } from '../utils/resourceLimits.js';
import { readCpuTopology, parseCpuList } from './cpuTopology.js';

// Read only display metadata; external container names remain managed by their owner.
export function externalContainerName(container: { Id: string; Name: string; Config?: { Labels?: Record<string, string>; Env?: string[] } }) {
    const rawName = container.Name.replace(/^\//, '');
    if (container.Config?.Labels?.Service !== 'Pterodactyl') return rawName;
    const env = new Map((container.Config.Env || []).map(entry => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
    const hostname = (env.get('HOSTNAME') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
    const friendly = hostname && hostname !== rawName && !/^[a-f0-9-]{12,}$/i.test(hostname);
    const port = env.get('SERVER_PORT') || '';
    const suffix = /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535 ? ` · :${port}` : '';
    return `${friendly ? hostname : `Pterodactyl ${rawName.slice(0, 8)}`}${suffix}`;
}

export async function availableCpus() {
    const [topology, servers, containers, engine] = await Promise.all([readCpuTopology(), serverRepository.listAll(), docker.listContainers({ all: true }), docker.info()]);
    if (engine.NCPU !== topology.availableCpuIds.length) throw Object.assign(new Error('Docker CPU topology does not match this node'), { statusCode: 503 });
    const inspected = await Promise.all(containers.map(async c => {
        try { return await docker.getContainer(c.Id).inspect(); }
        catch (error) { if ((error as any).statusCode === 404) return null; throw error; }
    }));
    const assignments: Array<{ serverId: number | null; containerId: string | null; containerName?: string; name: string; source: string; state: string; configuredCpuSet: number[]; effectiveCpuSet: number[]; pendingCpuSet: number[] | null }> = servers.map(server => {
        const actual = inspected.find(c => c?.Id === server.docker_container_id);
        const pending = JSON.parse(server.provider_metadata_json || '{}').pendingConfiguration;
        return { serverId: server.id, containerId: actual?.Id ?? null, name: server.name, source: 'panel', state: actual?.State.Status ?? 'missing',
            configuredCpuSet: parseStoredResourceLimits(server)?.cpuSet ?? [],
            effectiveCpuSet: actual ? parseCpuList(actual.HostConfig.CpusetCpus || '') : [],
            pendingCpuSet: pending?.hasResourceLimitsPatch ? pending.resourceLimits?.cpuSet ?? [] : null };
    });
    for (const actual of inspected) {
        if (!actual || servers.some(s => s.docker_container_id === actual.Id)) continue;
        assignments.push({ serverId: null, containerId: actual.Id, containerName: actual.Name.replace(/^\//, ''), name: externalContainerName(actual), source: 'external', state: actual.State.Status,
            configuredCpuSet: parseCpuList(actual.HostConfig.CpusetCpus || ''), effectiveCpuSet: parseCpuList(actual.HostConfig.CpusetCpus || ''), pendingCpuSet: null });
    }
    return { ...topology, assignments, unboundContainerCount: assignments.filter(a => a.state === 'running' && !a.effectiveCpuSet.length).length };
}
