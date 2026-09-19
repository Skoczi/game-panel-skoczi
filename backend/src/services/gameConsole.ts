import type { GameServerRow } from '../types/gameServer.js';
import { sendLinuxGsmConsoleCommand } from '../providers/linuxgsm/console.js';
import { sendOvhcloudConsoleCommand } from '../providers/ovhcloud/console.js';
import { nativeTemplate } from '../templates/nativeContract.js';
import { docker } from '../utils/docker/client.js';
import { ownsContainer } from '../utils/docker/ownership.js';
import type { Duplex } from 'node:stream';

export type GameConsoleCommandResult = {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
};

type GameServerWithContainer = GameServerRow & {
    docker_container_id: string;
};

function normalizeCommand(command: unknown): string {
    if (typeof command !== 'string') {
        throw Object.assign(new Error('command must be a string'), { statusCode: 400 });
    }

    const normalized = command.trim();
    if (!normalized) {
        throw Object.assign(new Error('command is required'), { statusCode: 400 });
    }

    if (normalized.length > 4000 || /[\0\r\n]/.test(normalized)) {
        throw Object.assign(new Error('command is invalid'), { statusCode: 400 });
    }

    return normalized;
}

export async function sendGameConsoleCommand(
    server: GameServerWithContainer,
    rawCommand: unknown
): Promise<GameConsoleCommandResult> {
    const command = normalizeCommand(rawCommand);

    if (nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'))) {
        const container = docker.getContainer(server.docker_container_id);
        const info = await container.inspect();
        if (!ownsContainer(info.Config.Labels) || info.Config.Labels?.['gamepanel.serverId'] !== String(server.id)) {
            throw Object.assign(new Error('Container ownership mismatch'), { statusCode: 409 });
        }
        if (!info.State.Running || !info.Config.OpenStdin) {
            throw Object.assign(new Error('Console requires a running native container with stdin enabled'), { statusCode: 409 });
        }
        const stream = await container.attach({ stream: true, stdin: true, stdout: false, stderr: false, hijack: true }) as Duplex;
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => { reject(new Error('Console write timed out')); stream.destroy(); }, 5000);
                const fail = (error: Error) => { clearTimeout(timer); reject(error); };
                stream.once('error', fail);
                stream.write(`${command}\n`, (error?: Error | null) => {
                    clearTimeout(timer);
                    if (error) reject(error); else resolve();
                });
            });
        } finally { stream.destroy(); }
        // The game's reply is delivered by the existing log subscription, not by a shell.
        return { ok: true, exitCode: 0, stdout: '', stderr: '' };
    }

    if (server.provider === 'linuxgsm') {
        return sendLinuxGsmConsoleCommand(server, command);
    }

    if (server.provider === 'ovhcloud') {
        return sendOvhcloudConsoleCommand(server, command);
    }

    throw Object.assign(new Error('Console commands are not supported for this provider'), { statusCode: 501 });
}
