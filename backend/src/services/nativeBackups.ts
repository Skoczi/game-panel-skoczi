import { withStorageReserve } from './storageReserve.js';
import { recordNativeBackup } from './nativeProtection.js';
import { syncDirectory } from './nativeRestoreJournal.js';
import { validateNativeArchive } from './nativeArchive.js';
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
    const template = nativeServerTemplate(server);
    if (!template) throw Object.assign(new Error('Not a native server'), { statusCode: 400 });
    if (!template.mounts.some(mount => mount.key === 'data')) throw Object.assign(new Error('Native backup requires the data/serverfiles layout'), { statusCode: 409 });
    const dir = path.join(getServerStoragePaths(server.id).serverRoot, 'data', 'backups');
    const data = path.dirname(dir);
    if (!(await fs.lstat(data)).isDirectory()) throw new Error('Invalid Native data root');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(dir)).isDirectory()) throw new Error('Invalid native backup directory');
    return dir;
}

export function normalizeBackupName(value: unknown): string {
    if (value === undefined || value === '') return '';
    if (typeof value !== 'string') throw Object.assign(new Error('Backup name must be text'), { statusCode: 400 });
    const name = value.trim().normalize('NFC').replace(/\.tar\.gz$/i, '');
    if (!name) return '';
    if (Buffer.byteLength(name, 'utf8') > 128) throw Object.assign(new Error('Backup name is too long; use a shorter name'), { statusCode: 400 });
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u.test(name)) throw Object.assign(new Error('Use up to 64 letters, numbers, spaces, dots, hyphens or underscores. Start with a letter or number.'), { statusCode: 400 });
    return name.replace(/ +/g, '-');
}

const busy = new Set<number>();
export async function createNativeBackup(server: GameServerRow & { docker_container_id: string }, operationHeld = false, requestedName?: string) {
    const backupName = normalizeBackupName(requestedName);
    if (!nativeServerTemplate(server)) throw new Error('Not a Native server');
    if (busy.has(server.id)) throw Object.assign(new Error('A backup is already running'), { statusCode: 409 });
    busy.add(server.id);
    let release: (() => void) | undefined;
    let temporary: string | undefined;
    try {
        // Live backups do not run game-specific save commands or stop the process.
        release = (operationHeld ? () => {} : acquireNativeOperation(server.id, true));
        const status = await checkContainerStatus(server.docker_container_id);
        const live = status === 'running';
        if (!['running', 'exited', 'created', 'dead'].includes(status)) {
            throw Object.assign(new Error('Wait until the server finishes its current transition before creating a Native backup'), { statusCode: 409 });
        }
        const directory = await nativeBackupDirectory(server);
        const { serverRoot } = getServerStoragePaths(server.id);
        const keys = ['serverfiles'];
        const fdl = await fs.lstat(path.join(serverRoot, 'data', 'fastdownload')).catch((e: any) => { if (e.code === 'ENOENT') return null; throw e; });
        if (fdl) { if (!fdl.isDirectory()) throw new Error('FastDownload must be a real directory'); keys.push('fastdownload'); }
        const archiveRoot = path.join(serverRoot, 'data');
        for (const key of keys) {
            if (!(await fs.lstat(path.join(archiveRoot, key)).catch(() => null))?.isDirectory()) throw Object.assign(new Error('Invalid native data mount: expected data/serverfiles; migrate legacy layouts explicitly'), { statusCode: 409 });
        }
        const filename = `native-${live ? 'live-' : ''}${backupName ? backupName + '-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.tar.gz`;
        temporary = path.join(directory, `${filename}.partial`);
        // argv only; exclude logs, installers and backups by archiving only serverfiles.
        try {
            await withStorageReserve(directory, signal => promisify(execFile)('tar', ['-czf', temporary!, '-C', archiveRoot, '--', ...keys], { signal, timeout: 600_000, maxBuffer: 1024 * 1024, env: { ...process.env, COPYFILE_DISABLE: '1' } }));
        } catch (error: any) {
            if (!live || error.code !== 1 || !String(error.stderr).includes('file changed as we read it')) throw error;
            await promisify(execFile)('tar', ['-tzf', temporary], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
        }
        await validateNativeArchive(temporary);
        await fs.chmod(temporary, 0o600);
        const output = await fs.open(temporary, 'r');
        try { await output.sync(); } finally { await output.close(); }
        await fs.rename(temporary, path.join(directory, filename));
        await syncDirectory(directory);
        temporary = undefined;
        const recordWarning = await recordNativeBackup(path.join(directory, filename), live).then(() => '', () => 'Archive created and checked, but its protection record could not be saved.');
        return { ok: true, exitCode: 0, stdout: `Native ${live ? 'live ' : ''}backup created: ${filename}${live ? '. Files may have changed during backup; game consistency is not guaranteed.' : ''}`, stderr: recordWarning };
    } finally {
        if (temporary) await fs.unlink(temporary).catch(() => {});
        busy.delete(server.id);
        release?.();
    }
}
