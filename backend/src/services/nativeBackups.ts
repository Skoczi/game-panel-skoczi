import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { nativeTemplate } from '../templates/nativeContract.js';
import { getServerStoragePaths } from '../utils/storage.js';
import { checkContainerStatus } from '../utils/docker.js';
import type { GameServerRow } from '../types/gameServer.js';
import { acquireNativeOperation } from './nativeOperationLock.js';

export function nativeServerTemplate(server: GameServerRow) {
    return nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'));
}

export async function nativeBackupDirectory(server: GameServerRow): Promise<string> {
    if (!nativeServerTemplate(server)) throw Object.assign(new Error('Not a native server'), { statusCode: 400 });
    const dir = path.join(getServerStoragePaths(server.id).serverRoot, '.native-backups');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(dir)).isDirectory()) throw new Error('Invalid native backup directory');
    return dir;
}

const busy = new Set<number>();
export async function createNativeBackup(server: GameServerRow & { docker_container_id: string }) {
    const template = nativeServerTemplate(server)!;
    if (busy.has(server.id)) throw Object.assign(new Error('A backup is already running'), { statusCode: 409 });
    busy.add(server.id);
    let release: (() => void) | undefined;
    let temporary: string | undefined;
    try {
        // No game-specific backup commands and no automatic disruption of a live game.
        release = acquireNativeOperation(server.id, true);
        if (!['exited', 'created', 'dead'].includes(await checkContainerStatus(server.docker_container_id))) {
            throw Object.assign(new Error('Stop the server before creating a native backup for consistent game files'), { statusCode: 409 });
        }
        const directory = await nativeBackupDirectory(server);
        const { serverRoot } = getServerStoragePaths(server.id);
        const keys = template.mounts.map(m => m.key);
        if (!keys.length) throw new Error('No native data mounts to back up');
        for (const key of keys) {
            if (!(await fs.lstat(path.join(serverRoot, key))).isDirectory()) throw new Error('Invalid native data mount');
        }
        const filename = `native-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.tar.gz`;
        temporary = path.join(directory, `${filename}.partial`);
        // argv only; tar does not dereference symlinks. Include every template mount.
        await promisify(execFile)('tar', ['-czf', temporary, '-C', serverRoot, '--', ...keys], { timeout: 600_000, maxBuffer: 1024 * 1024 });
        await fs.chmod(temporary, 0o600);
        await fs.rename(temporary, path.join(directory, filename));
        temporary = undefined;
        return { ok: true, exitCode: 0, stdout: `Native backup created: ${filename}`, stderr: '' };
    } finally {
        if (temporary) await fs.unlink(temporary).catch(() => {});
        busy.delete(server.id);
        release?.();
    }
}
