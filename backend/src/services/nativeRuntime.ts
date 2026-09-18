import { randomUUID } from 'node:crypto';
import { docker } from '../utils/docker/client.js';
import { ownsContainer } from '../utils/docker/ownership.js';
import { serverRepository, actionsRepository, installProgressRepository } from '../database/index.js';
import type { ServerMountPath } from '../utils/storage.js';
import type { GameTemplate } from '../templates/types.js';
import { renderNativeArgv } from '../templates/nativeContract.js';
import { nativeScriptArchive } from './nativeScript.js';

export class NativeCleanupError extends Error {}

export async function runNativeSteps(params: {
    serverId: number; image: string; template: GameTemplate;
    phase: 'install' | 'update'; env: Record<string, string>; mounts: ServerMountPath[];
}) {
    const { serverId, template: t, phase } = params;
    const identity = t.runtime.identity!;
    for (const [index, step] of t.lifecycle![phase].entries()) {
        if (!(await serverRepository.findById(serverId))) throw new Error('Native operation cancelled: server no longer exists');
        await actionsRepository.create(serverId, 'info', `Native ${phase}: step ${index + 1} · ${step.name}`, '');
        const scriptName = `gamepanel-script-${randomUUID()}.sh`;
        const scripted = step.script !== undefined;
        const container = await docker.createContainer({
            Image: params.image,
            name: `gp-native-${phase}-${randomUUID()}`,
            Entrypoint: [],
            Cmd: scripted
                ? ['/bin/bash', '--noprofile', '--norc', '-e', '-u', '-o', 'pipefail', `/tmp/${scriptName}`]
                : renderNativeArgv(step.argv!, params.env),
            Env: Object.entries(params.env).map(([key, value]) => `${key}=${value}`),
            User: `${identity.uid}:${identity.gid}`,
            WorkingDir: t.lifecycle!.workdir,
            Labels: { 'gamepanel.managed': 'true', 'gamepanel.oneshot': 'true', 'gamepanel.nativeOperation': phase, 'gamepanel.serverId': String(serverId) },
            HostConfig: {
                Binds: params.mounts.map(m => `${m.hostPath}:${m.containerPath}`),
                RestartPolicy: { Name: 'no' },
                CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
                Memory: 2 * 1024 ** 3, PidsLimit: 256, NanoCpus: 2e9,
                LogConfig: { Type: 'local', Config: { 'max-size': '10m', 'max-file': '2' } },
            },
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const expired = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Native ${phase} step ${index + 1} timed out after ${step.timeoutSeconds}s`)), step.timeoutSeconds * 1000);
            });
            const result = await Promise.race([
                (async () => {
                    if (scripted) {
                        const archive = await nativeScriptArchive(scriptName, step.script!, identity.uid, identity.gid);
                        await container.putArchive(archive, { path: '/tmp' });
                    }
                    await container.start();
                    return container.wait();
                })().catch(() => { throw new Error(`Native ${phase} step ${index + 1} could not execute. Check the installer image, Bash and node Docker service.`); }),
                expired,
            ]);
            if (Number(result.StatusCode) !== 0) throw new Error(`Native ${phase} step ${index + 1} failed (exit ${Number(result.StatusCode)})`);
        } finally {
            if (timer) clearTimeout(timer);
            // Never include raw installer output, argv or env in public errors (may contain secrets).
            // Fail closed if cleanup fails: leave the persistent operation marker for boot recovery.
            try { await container.remove({ force: true }); }
            catch (error: any) {
                if (error?.statusCode !== 404) throw new NativeCleanupError('Native maintenance container could not be removed. Restart the agent to recover before changing this server.');
            }
        }
    }
}

// Agent interruption is not an instruction to repeat arbitrary install/update commands.
// Stop only this runtime's labelled maintenance containers and require operator inspection.
export async function recoverNativeOperations() {
    const containers = await docker.listContainers({ all: true, filters: { label: ['gamepanel.nativeOperation'] } });
    for (const container of containers) {
        if (!ownsContainer(container.Labels)) continue;
        await docker.getContainer(container.Id).remove({ force: true });
    }
    for (const server of await serverRepository.listAll()) {
        const runtime = JSON.parse(server.runtime_config_json || '{}');
        if (!runtime.nativeOperation) continue;
        if (server.docker_container_id) {
            const container = docker.getContainer(server.docker_container_id);
            const info = await container.inspect().catch((error: any) => { if (error?.statusCode === 404) return null; throw error; });
            if (info?.State.Running) await container.stop({ t: 30 });
        }
        delete runtime.nativeOperation;
        runtime.nativeInterrupted = true;
        await serverRepository.update(server.id, { runtime_config_json: JSON.stringify(runtime), desired_state: 'stopped' });
        const message = 'Native operation interrupted by agent restart. Inspect game files before retrying; no steps were repeated.';
        await serverRepository.markFailed(server.id, message);
        await installProgressRepository.update(server.id, 0, 'failed', message);
        await actionsRepository.create(server.id, 'error', message, '');
    }
}
