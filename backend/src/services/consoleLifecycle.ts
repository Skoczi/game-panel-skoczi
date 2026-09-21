import { actionsRepository, serverRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { gameStartup, formatStartup } from '../templates/startupCommand.js';
import { nativeTemplate } from '../templates/nativeContract.js';
import { redactNativeLog } from './nativeLogs.js';
import { logError } from '../utils/logger.js';

export const CONSOLE_PREFIX = '[GamePanel] ';
const messages: Record<string, string> = {
    installing: 'Installing server…',
    starting: 'Starting server…',
    restarting: 'Restarting server…',
    stopping: 'Stopping server…',
    stopped: 'Server is offline.',
    running: 'Container is running.',
    unhealthy: 'Container health check failed.',
    failed: 'Server operation failed. Check Activity for details.',
};
const pending = new Map<number, Promise<void>>();

// Only expose the game argv, never the shell setup script or environment dump.
export function safeStartupCommand(config: { Cmd?: string[] | null; Entrypoint?: string[] | string | null; Env?: string[] | null }, secretKeys: string[]): string | null {
    const entrypoint = typeof config.Entrypoint === 'string' ? [config.Entrypoint] : config.Entrypoint || [];
    const argv = [...entrypoint, ...(config.Cmd || [])];
    const game = gameStartup(argv);
    if (!game || (/^(?:.*\/)?(?:bash|sh|dash|ash|zsh)$/.test(argv[0] || '') && !game.wrapped)) return null;
    const secrets = (config.Env || []).flatMap(entry => {
        const at = entry.indexOf('=');
        const key = entry.slice(0, at);
        return at > 0 && (secretKeys.includes(key) || /password|passwd|secret|token|credential|api_?key|steam.*account|rcon/i.test(key)) ? [entry.slice(at + 1)] : [];
    });
    let hideNext = false;
    const command = game.command.map(arg => {
        if (hideNext) { hideNext = false; return '[hidden]'; }
        if (/^[+-].*(?:password|passwd|secret|token|credential|api_?key|sv_setsteamaccount|rcon)/i.test(arg)) {
            if (arg.includes('=')) return arg.slice(0, arg.indexOf('=') + 1) + '[hidden]';
            hideNext = true;
        }
        return arg;
    });
    return redactNativeLog(formatStartup(command), secrets);
}

export function recordConsoleStatus(serverId: number, status: string, timestamp?: string): Promise<void> {
    const previous = pending.get(serverId) || Promise.resolve();
    const next = previous.then(async () => {
        const message = messages[status];
        if (!message) return;
        const server = await serverRepository.findById(serverId);
        if (!server) return;
        await actionsRepository.create(serverId, 'info', CONSOLE_PREFIX + message, '', timestamp);
    }).catch(error => logError('CONSOLE:LIFECYCLE', error, { serverId }));
    pending.set(serverId, next);
    void next.finally(() => { if (pending.get(serverId) === next) pending.delete(serverId); });
    return next;
}

// Docker events include automatic restarts and the offline interval of a restart.
export function recordDockerLifecycle(serverId: number, containerId: string, action: string, exitCode?: string, timestamp?: string): Promise<void> {
    if (!['start', 'die', 'oom'].includes(action)) return Promise.resolve();
    const previous = pending.get(serverId) || Promise.resolve();
    const next = previous.then(async () => {
        const server = await serverRepository.findById(serverId);
        if (!server) return;
        if (action === 'die') {
            const code = /^\d{1,3}$/.test(exitCode || '') ? ` Exit code: ${exitCode}.` : '';
            await actionsRepository.create(serverId, 'info', CONSOLE_PREFIX + 'Container exited.' + code, '', timestamp);
            return;
        }
        if (action === 'oom') {
            await actionsRepository.create(serverId, 'error', CONSOLE_PREFIX + 'Container exceeded its memory limit (OOM).', '', timestamp);
            return;
        }
        await actionsRepository.create(serverId, 'info', CONSOLE_PREFIX + 'Container started.', '', timestamp);
        const inspect = await docker.getContainer(containerId).inspect();
        const template = nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'));
        const command = safeStartupCommand(inspect.Config, template?.variables.filter(v => v.secret).map(v => v.key) || []);
        if (command) await actionsRepository.create(serverId, 'info', CONSOLE_PREFIX + 'Startup command: ' + command, '', timestamp);
    }).catch(error => logError('CONSOLE:DOCKER', error, { serverId, action }));
    pending.set(serverId, next);
    void next.finally(() => { if (pending.get(serverId) === next) pending.delete(serverId); });
    return next;
}

export async function consoleLogHistory(serverId: number, install: string[], container: string[]): Promise<string[]> {
    await pending.get(serverId);
    const actions = await actionsRepository.getRecent(serverId, 100);
    const markers = actions.filter(a => a.message.startsWith(CONSOLE_PREFIX)).reverse().map(a => `${a.timestamp} ${a.message}`);
    // Keep untimestamped installer output first; timestamped Docker and panel events interleave.
    const lines = [...install, ...container, ...markers];
    return lines.map((line, index) => ({ line, index, time: Date.parse(/^\d{4}-\d\d-\d\dT\S+/.exec(line)?.[0] || '') || 0 }))
        .sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : a.index - b.index).map(v => v.line);
}
