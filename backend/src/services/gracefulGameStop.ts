import { docker } from '../utils/docker/client.js';
import { ownsContainer } from '../utils/docker/ownership.js';
import { serverRepository, actionsRepository } from '../database/index.js';
import { getDatabase } from '../database/init.js';
import { nativeTemplate } from '../templates/nativeContract.js';
import { sendGameConsoleCommand } from './gameConsole.js';
import { logError } from '../utils/logger.js';

type RestartPolicy = { Name: string; MaximumRetryCount?: number };
type SavedPolicy = { containerId: string; policy: RestartPolicy };

function savedPolicy(raw: string | null | undefined, containerId: string): SavedPolicy | null {
    const saved = JSON.parse(raw || '{}').nativeGracefulStop;
    return saved?.containerId === containerId && ['no', 'always', 'unless-stopped', 'on-failure'].includes(saved.policy?.Name) ? saved : null;
}

async function rememberPolicy(serverId: number, saved: SavedPolicy): Promise<void> {
    const db = await getDatabase();
    await db.run("UPDATE game_servers SET runtime_config_json = json_set(COALESCE(runtime_config_json, '{}'), '$.nativeGracefulStop', json(?)) WHERE id = ?", JSON.stringify(saved), serverId);
}
async function forgetPolicy(serverId: number, containerId: string): Promise<void> {
    const db = await getDatabase();
    await db.run("UPDATE game_servers SET runtime_config_json = json_remove(runtime_config_json, '$.nativeGracefulStop') WHERE id = ? AND json_extract(runtime_config_json, '$.nativeGracefulStop.containerId') = ?", serverId, containerId);
}
async function note(serverId: number, message: string): Promise<void> {
    await actionsRepository.create(serverId, 'info', '[GamePanel] ' + message, '').catch(error => logError('GAME:STOP:LOG', error, { serverId }));
}

// Shutdown is selected by the installed template, not by game name or executable.
export async function tryGracefulGameStop(containerId: string, timeoutSeconds: number): Promise<boolean> {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const labels = info.Config.Labels || {};
    if (!ownsContainer(labels) || labels['gamepanel.oneshot'] === 'true') return false;
    const serverId = Number(labels['gamepanel.serverId']);
    if (!Number.isSafeInteger(serverId) || serverId <= 0) return false;
    const server = await serverRepository.findById(serverId);
    if (!server || server.docker_container_id !== containerId) return false;
    const command = nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'))?.lifecycle?.stopCommand;
    if (!command || !info.Config.OpenStdin) return false;
    if (!info.State.Running) return true;

    // quit is a normal process exit: unless-stopped would otherwise start it again.
    // Persist the original policy before changing Docker so an agent restart cannot lose it.
    const original = savedPolicy(server.runtime_config_json, containerId)?.policy || info.HostConfig.RestartPolicy || { Name: 'no' };
    if (original.Name !== 'no') {
        await rememberPolicy(serverId, { containerId, policy: original });
        await container.update({ RestartPolicy: { Name: 'no', MaximumRetryCount: 0 } });
    }
    try {
        await note(serverId, 'Sending the template stop command; waiting for the game to shut down…');
        try {
            await sendGameConsoleCommand({ ...server, docker_container_id: containerId }, command);
            const deadline = Date.now() + Math.max(1, Math.min(300, timeoutSeconds)) * 1000;
            while (Date.now() < deadline) {
                const state = (await container.inspect()).State;
                if (!state.Running && !state.Restarting) return true;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            await note(serverId, 'Game did not exit in time. Falling back to container stop.');
        } catch (error) {
            const state = (await container.inspect()).State;
            if (!state.Running && !state.Restarting) return true;
            logError('GAME:STOP:QUIT', error, { serverId });
            await note(serverId, 'Could not send the template stop command. Falling back to container stop.');
        }
        await container.stop({ t: timeoutSeconds });
        return true;
    } catch (error) {
        // If stopping failed and the process is still alive, restore crash recovery.
        const state = await container.inspect().catch(() => null);
        if (state?.State.Running && original.Name !== 'no') {
            await container.update({ RestartPolicy: original });
            await forgetPolicy(serverId, containerId);
        }
        throw error;
    }
}

// Stop keeps restart policy disabled, including across daemon/agent restarts.
// Only an explicit subsequent Start/Restart re-enables the original policy.
export async function restoreGracefulRestartPolicy(containerId: string): Promise<(() => Promise<void>) | null> {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    const labels = info.Config.Labels || {};
    if (!ownsContainer(labels) || labels['gamepanel.oneshot'] === 'true') return null;
    const serverId = Number(labels['gamepanel.serverId']);
    if (!Number.isSafeInteger(serverId) || serverId <= 0) return null;
    const server = await serverRepository.findById(serverId);
    if (!server || server.docker_container_id !== containerId) return null;
    const saved = savedPolicy(server.runtime_config_json, containerId);
    if (!saved) return null;
    await container.update({ RestartPolicy: saved.policy });
    return () => forgetPolicy(serverId, containerId);
}

export async function recoverGracefulRestartPolicies(): Promise<void> {
    for (const server of await serverRepository.listAll()) {
        const id = server.docker_container_id;
        if (!id || !savedPolicy(server.runtime_config_json, id)) continue;
        try {
            const info = await docker.getContainer(id).inspect();
            // A stopped game must stay stopped. A still-running game regains its normal
            // crash policy after an interrupted API operation; recovery never restarts it.
            if (!info.State.Running) continue;
            const finish = await restoreGracefulRestartPolicy(id);
            await finish?.();
        } catch (error) { logError('GAME:STOP:RECOVERY', error, { serverId: server.id }); }
    }
}
