import Docker from 'dockerode';
import { getConfig } from '../../config.js';
import { ownsContainer, runtimeLabels } from './ownership.js';

const { dockerSocket } = getConfig();

export const docker = new Docker({
    socketPath: dockerSocket,
});

// Guard operations even if a stale database contains a foreign Docker ID.
const rawGet = docker.getContainer.bind(docker);
const guarded = new Set(['start', 'stop', 'restart', 'remove', 'update', 'rename', 'exec', 'attach', 'kill', 'pause', 'unpause', 'putArchive', 'getArchive']);
docker.getContainer = ((id: string) => {
    const container = rawGet(id);
    return new Proxy(container, { get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== 'function') return value;
        if (!guarded.has(String(property))) return value.bind(target);
        return async (...args: unknown[]) => {
            const info = await target.inspect();
            if (!ownsContainer(info.Config.Labels || {})) throw new Error('Container is not owned by this runtime');
            return value.apply(target, args);
        };
    } });
}) as typeof docker.getContainer;
const rawCreate = docker.createContainer.bind(docker);
docker.createContainer = ((options: Docker.ContainerCreateOptions) => rawCreate({ ...options,
    Labels: { ...options.Labels, ...runtimeLabels() },
})) as typeof docker.createContainer;
