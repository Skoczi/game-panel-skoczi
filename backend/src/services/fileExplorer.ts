import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getServerStoragePaths } from '../utils/storage.js';
import {
    ensureResolvedPathInsideRoot,
    listDirectory,
    resolveSafeChildPath,
    type FsEntry
} from '../utils/fsBrowser.js';
import { getServerOrThrow } from './servers.js';
import type { GameServerRow } from '../types/gameServer.js';
import { parseStoredMounts } from '../providers/runtimeConfig.js';
import { nativeBackupDirectory, nativeServerTemplate } from './nativeBackups.js';

type ListFilesResult = {
    root: string;
    path: string;
    entries: FsEntry[];
    roots: FileRoot[];
};

type FileRoot = {
    key: string;
    containerPath: string;
};

type ServerFsRoot = string;

export async function getServerFsRoot(params: {
    serverId: number;
    root: ServerFsRoot;
}): Promise<{ server: GameServerRow; root: string; rootDir: string; roots: FileRoot[] }> {
    const server = await getServerOrThrow(params.serverId);
    if (params.root === 'native-backups') {
        return { server, root: 'native-backups', rootDir: await nativeBackupDirectory(server), roots: [] };
    }
    const mounts = parseStoredMounts(server);
    const roots = mounts.map((mount) => ({
        key: mount.key,
        containerPath: mount.containerPath,
    }));

    if (roots.length === 0) {
        throw Object.assign(new Error('No filesystem mounts configured for this server'), { statusCode: 404 });
    }

    const root = params.root || 'data';
    const mount = mounts.find((entry) => entry.key === root);
    if (!mount) {
        throw Object.assign(new Error(`Mount root not found: ${root}`), { statusCode: 404 });
    }

    const { serverRoot } = getServerStoragePaths(params.serverId);
    const rootDir = path.join(serverRoot, mount.key);
    return { server, root, rootDir, roots };
}

export async function listServerFileRoots(serverId: number): Promise<{ roots: FileRoot[] }> {
    const server = await getServerOrThrow(serverId);
    const roots = parseStoredMounts(server).map((mount) => ({
        key: mount.key,
        containerPath: mount.containerPath,
    }));

    return { roots };
}

export async function listServerFiles(params: {
    serverId: number;
    path?: string;
    root?: ServerFsRoot;
}): Promise<ListFilesResult> {
    const root = params.root ?? 'data';
    const fsRoot = await getServerFsRoot({ serverId: params.serverId, root });

    const resolved = resolveSafeChildPath(fsRoot.rootDir, params.path);
    if (fsRoot.root !== 'native-backups') await assertPublicServerPath(params.serverId, resolved.absPath);
    const st = await fs.lstat(resolved.absPath).catch(() => null);

    if (!st) throw Object.assign(new Error('Path not found'), { statusCode: 404 });
    if (st.isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not allowed'), { statusCode: 400 });
    await ensureResolvedPathInsideRoot(resolved.absPath, fsRoot.rootDir);
    if (!st.isDirectory()) throw Object.assign(new Error('Path is not a directory'), { statusCode: 400 });

    let entries = await listDirectory(resolved.absPath);
    if (nativeServerTemplate(fsRoot.server) && fsRoot.root === 'data' && resolved.apiPath === '/') entries = entries.filter(entry => entry.name !== 'backups');
    return {
        root: fsRoot.root,
        path: resolved.apiPath,
        entries,
        roots: fsRoot.roots,
    };
}

export async function resolveServerPath(params: {
    serverId: number;
    path?: string;
    root?: ServerFsRoot;
}): Promise<{ root: string; apiPath: string; absPath: string; rootDir: string }> {
    const root = params.root ?? 'data';
    const fsRoot = await getServerFsRoot({ serverId: params.serverId, root });
    const resolved = resolveSafeChildPath(fsRoot.rootDir, params.path);
    if (root !== 'native-backups') await assertPublicServerPath(params.serverId, resolved.absPath);
    return {
        root: fsRoot.root,
        ...resolved,
        rootDir: fsRoot.rootDir,
    };
}

// Physical placement does not grant file-manager access to managed backup data.
export async function assertPublicServerPath(serverId: number, filename: string, recursive = false): Promise<void> {
    const server = await getServerOrThrow(serverId);
    if (!nativeServerTemplate(server)) return;
    const reserved = path.resolve(getServerStoragePaths(serverId).serverRoot, 'data', 'backups');
    async function canonical(filename: string): Promise<string> {
        try { return await fs.realpath(filename); }
        catch (error: any) {
            if (error.code !== 'ENOENT') throw error;
            const parent = path.dirname(filename);
            if (parent === filename) throw error;
            return path.join(await canonical(parent), path.basename(filename));
        }
    }
    const target = path.resolve(filename);
    const actual = await canonical(target), privateRoot = await canonical(reserved);
    const overlaps = (file: string, privateDir: string) => file === privateDir || file.startsWith(privateDir + path.sep) || (recursive && privateDir.startsWith(file + path.sep));
    if (overlaps(target, reserved) || overlaps(actual, privateRoot)) {
        throw Object.assign(new Error('This directory contains managed backups. Use Backups to access them; select serverfiles for game files.'), { statusCode: 403 });
    }
}
