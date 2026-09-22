import { withStorageReserve } from './storageReserve.js';
import { validateNativeArchive } from './nativeArchive.js';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import { nativeBackupDirectory, nativeServerTemplate } from './nativeBackups.js';
import { getServerStoragePaths } from '../utils/storage.js';
import { checkContainerStatus } from '../utils/docker.js';
import { beginRestoreJournal, finishRestoreJournal, syncDirectory } from './nativeRestoreJournal.js';
import { acquireNativeOperation, blockNativeServer } from './nativeOperationLock.js';
import type { GameServerRow } from '../types/gameServer.js';

// Stage regular files first; create only links whose resolved targets stay inside the game directory.
export async function stageNativeArchive(archive: string, staging: string, keys: string[]) {
    await validateNativeArchive(archive);
    const extractor = tar.extract();
    const canonicalStaging = await fs.realpath(staging);
    const seen = new Set<string>();
    const roots = new Set<string>();
    const directoryModes = new Map<string, number>();
    const links: Array<{ name: string; target: string; type: 'link' | 'symlink'; uid: number; gid: number }> = [];
    const space = await fs.statfs(staging);
    const budget = Number(space.bavail) * Number(space.bsize) - 64 * 1024 * 1024;
    let bytes = 0;
    let entries = 0;
    extractor.on('entry', (header, stream, next) => {
        stream.on('error', error => extractor.destroy(error));
        void (async () => {
            const name = header.name.replace(/\/$/, '');
            const parts = name.split('/');
            if (!name || path.posix.isAbsolute(name) || parts.some(p => !p || p === '.' || p === '..') || name.includes('\\') || !keys.includes(parts[0])) throw new Error('Archive contains an invalid path or an unknown mount');
            if (seen.has(name)) throw new Error('Archive contains duplicate entries');
            seen.add(name);
            if (++entries > 1_000_000) throw new Error('Archive contains too many entries');
            if (!['file', 'directory', 'link', 'symlink'].includes(header.type || '')) throw new Error('Archive contains unsupported special files');
            if (parts.length === 1) {
                if (header.type !== 'directory') throw new Error('Archive mount must be a directory');
                roots.add(parts[0]);
            }
            bytes += header.size || 0;
            if (!Number.isSafeInteger(bytes) || bytes > budget) throw new Error('Not enough free space to safely stage this backup');
            const destination = path.join(staging, ...parts);
            if (header.type === 'symlink' || header.type === 'link') {
                const target = header.linkname || '';
                const resolved = path.posix.normalize(header.type === 'symlink' ? path.posix.join(path.posix.dirname(name), target) : target);
                if (!target || path.posix.isAbsolute(target) || target.includes('\\') || !keys.some(key => resolved.startsWith(`${key}/`) || resolved === key)) throw new Error('Archive link escapes the game directory');
                links.push({ name, target, type: header.type, uid: header.uid ?? 0, gid: header.gid ?? 0 });
                stream.resume(); next(); return;
            }
            if (header.type === 'directory') {
                await fs.mkdir(destination, { recursive: true, mode: 0o700 });
                directoryModes.set(destination, (header.mode ?? 0o755) & 0o777);
                stream.resume();
                // Directory modes are applied after extraction so read-only parents remain writable during staging.
            } else {
                await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
                await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
                const handle = await fs.open(destination, 'r'); try { await handle.sync(); } finally { await handle.close(); }
                await fs.chmod(destination, (header.mode ?? 0o600) & 0o777);
            }
            if (process.getuid?.() === 0) await fs.chown(destination, header.uid ?? 0, header.gid ?? 0);
            next();
        })().catch(error => extractor.destroy(error));
    });
    await withStorageReserve(staging, signal => pipeline(createReadStream(archive), createGunzip(), extractor, { signal }));
    if (keys.some(key => !roots.has(key))) throw new Error('Archive does not contain every current data mount');
    // Reserve every parent as a real directory before creating links. A link cannot become
    // an ancestor of another entry and redirect later writes outside staging.
    for (const link of links) await fs.mkdir(path.dirname(path.join(staging, link.name)), { recursive: true });
    for (const link of links.filter(link => link.type === 'link')) {
        const destination = path.join(staging, link.name);
        const target = path.join(staging, link.target);
        if (!(await fs.lstat(target)).isFile()) throw new Error('Invalid archive hard link target');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.link(target, destination);
    }
    for (const link of links.filter(link => link.type === 'symlink')) {
        const destination = path.join(staging, link.name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.symlink(link.target, destination);
        if (process.getuid?.() === 0) await fs.lchown(destination, link.uid, link.gid);
    }
    for (const link of links) {
        let actual: string;
        try { actual = await fs.realpath(path.join(staging, link.name)); }
        catch (error: any) {
            // The archive validator has checked every component of this relative link.
            if (link.type === 'symlink' && error.code === 'ENOENT') continue;
            throw error;
        }
        if (!keys.some(key => actual.startsWith(path.join(canonicalStaging, key) + path.sep) || actual === path.join(canonicalStaging, key))) throw new Error('Archive link resolves outside the game directory');
    }
    for (const [destination, mode] of [...directoryModes].sort((a,b) => b[0].length - a[0].length)) { await syncDirectory(destination); await fs.chmod(destination, mode); }
    await syncDirectory(staging);
}

export async function restoreNativeBackup(server: GameServerRow & { docker_container_id: string }, apiPath: string, operationHeld = false) {
    const release = (operationHeld ? () => {} : acquireNativeOperation(server.id, true));
    let staging: string | undefined;
    let journalActive = false;
    try {
        if (!['exited', 'created', 'dead'].includes(await checkContainerStatus(server.docker_container_id))) throw Object.assign(new Error('Stop the server before restoring a Native backup'), { statusCode: 409 });
        const template = nativeServerTemplate(server);
        if (!template) throw new Error('Not a Native server');
        const name = apiPath.replace(/^\//, '');
        if (path.basename(name) !== name || !name.endsWith('.tar.gz')) throw Object.assign(new Error('Invalid backup filename'), { statusCode: 400 });
        const directory = await nativeBackupDirectory(server);
        const archive = path.join(directory, name);
        if (!(await fs.lstat(archive)).isFile()) throw new Error('Backup must be a regular file');
        const serverRoot = path.join(getServerStoragePaths(server.id).serverRoot, 'data');
        const keys = await validateNativeArchive(archive);
        if (keys.includes('fastdownload')) await fs.mkdir(path.join(serverRoot, 'fastdownload'), {mode:0o755}).catch(e => { if(e.code !== 'EEXIST') throw e; });
        for (const key of keys) if (!(await fs.lstat(path.join(serverRoot, key))).isDirectory()) throw new Error('Invalid Native mount');
        staging = await fs.mkdtemp(path.join(directory, '.restore-'));
        await stageNativeArchive(archive, staging, keys);
        if (!['exited', 'created', 'dead'].includes(await checkContainerStatus(server.docker_container_id))) throw new Error('Server state changed during restore preparation');
        const recovery = path.join(directory, `recovery-${randomUUID()}`);
        await fs.mkdir(recovery, { mode: 0o700 });
        await fs.writeFile(path.join(recovery, 'recovery.json'), JSON.stringify({ archive: name, mounts: keys, state: 'prepared', createdAt: new Date().toISOString() }), { mode: 0o600 });
        await syncDirectory(directory);
        await beginRestoreJournal(server.id, { recovery: path.basename(recovery), staging: path.basename(staging), keys });
        journalActive = true;
        const moved: string[] = [];
        const installed: string[] = [];
        try {
            for (const key of keys) {
                await fs.rename(path.join(serverRoot, key), path.join(recovery, key));
                moved.push(key);
                await syncDirectory(serverRoot);
                await syncDirectory(recovery);
                await fs.rename(path.join(staging, key), path.join(serverRoot, key));
                installed.push(key);
                await syncDirectory(serverRoot);
            }
        } catch (error) {
            try {
                for (const key of installed.reverse()) await fs.rename(path.join(serverRoot, key), path.join(staging, key));
                for (const key of moved.reverse()) await fs.rename(path.join(recovery, key), path.join(serverRoot, key));
                await syncDirectory(serverRoot);
                await finishRestoreJournal(server.id); journalActive = false;
            } catch {
                throw new Error(`Restore interrupted; recovery data retained at ${recovery}. Keep the server stopped and recover its mounts before starting.`);
            }
            throw error;
        }
        await fs.writeFile(path.join(recovery, 'recovery.json'), JSON.stringify({ archive: name, mounts: keys, state: 'completed', completedAt: new Date().toISOString() }), { mode: 0o600 });
        await finishRestoreJournal(server.id); journalActive = false;
        return { ok: true, exitCode: 0, stdout: `Native backup restored. Server remains stopped. Previous data retained in ${path.basename(recovery)}.`, stderr: '', recovery: path.basename(recovery) };
    } finally {
        if (journalActive) blockNativeServer(server.id, 'Restore was interrupted. Restart the agent to recover before changing this server.');
        if (staging && !journalActive) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        release();
    }
}
