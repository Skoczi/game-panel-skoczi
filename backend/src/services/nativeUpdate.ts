import { serverRepository, actionsRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { parseStoredEnv, parseStoredMounts, parseStoredPorts } from '../providers/runtimeConfig.js';
import { ensureServerMountDirs } from '../utils/storage.js';
import { nativeTemplate, nativeEnvironment } from '../templates/nativeContract.js';
import { acquireNativeOperation } from './nativeOperationLock.js';
import { NativeCleanupError, runNativeSteps } from './nativeRuntime.js';
import { logError } from '../utils/logger.js';

export async function startNativeUpdate(id: number, actor: string) {
    const release = acquireNativeOperation(id, true);
    try {
        const server = await serverRepository.findById(id);
        if (!server) throw Object.assign(new Error('Server not found'), { statusCode: 404 });
        const template = nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'));
        if (!template?.lifecycle?.update.length) throw Object.assign(new Error('This server has no native update recipe'), { statusCode: 400 });
        if (!['stopped', 'failed'].includes(server.status) || server.desired_state !== 'stopped' || !server.docker_container_id) throw Object.assign(new Error('Stop the server before updating'), { statusCode: 409 });
        const container = await docker.getContainer(server.docker_container_id).inspect();
        if (!['exited', 'created'].includes(container.State.Status)) throw Object.assign(new Error('Game container must be stopped'), { statusCode: 409 });
        // Use the exact image of the stopped game container, not a potentially moved tag.
        const image = container.Image;
        const env = nativeEnvironment(template, parseStoredEnv(server), parseStoredPorts(server));
        const mounts = await ensureServerMountDirs(id, parseStoredMounts(server), template.runtime.identity);
        const runtime = JSON.parse(server.runtime_config_json || '{}');
        await serverRepository.update(id, { runtime_config_json: JSON.stringify({ ...runtime, nativeOperation: 'update' }) });
        await actionsRepository.create(id, 'info', 'Native update requested; existing files may be changed. Server will remain stopped.', actor);
        void (async () => {
            let cleanupFailed = false;
            let interrupted = true;
            try {
                await runNativeSteps({ serverId: id, image, template, phase: 'update', env, mounts });
                interrupted = false;
                await serverRepository.update(id, { status: 'stopped', last_error: null });
                await actionsRepository.create(id, 'success', 'Native update completed. Start the server when ready.', actor);
            } catch (error) {
                cleanupFailed = error instanceof NativeCleanupError;
                const message = error instanceof Error ? error.message : 'Native update failed';
                await serverRepository.markFailed(id, message);
                await actionsRepository.create(id, 'error', message, actor);
            } finally {
                if (!cleanupFailed) {
                    delete runtime.nativeOperation;
                    await serverRepository.update(id, { runtime_config_json: JSON.stringify({ ...runtime, nativeInterrupted: interrupted }) });
                    release();
                }
            }
        })().catch(error => logError('NATIVE:UPDATE', error, { serverId: id }));
    } catch (error) { release(); throw error; }
}
