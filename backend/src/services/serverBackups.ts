import { getOvhcloudServerAdapter } from '../providers/ovhcloud/adapters/registry.js';
import type {
    OvhcloudBackupCreateResult,
    OvhcloudBackupDirectory,
    OvhcloudBackupFilePair,
    OvhcloudBackupRestoreInput,
    OvhcloudBackupRestoreResult,
    OvhcloudBackupSupport,
} from '../providers/ovhcloud/adapters/types.js';
import { getLinuxGsmMetadata } from '../providers/serverMetadata.js';
import type { GameServerRow } from '../types/gameServer.js';
import * as dockerUtils from '../utils/docker.js';
import type { FsEntry } from '../utils/fsBrowser.js';
import { nativeServerTemplate, nativeBackupDirectory, createNativeBackup } from './nativeBackups.js';

const LINUXGSM_BACKUP_EXTENSIONS = ['.tar.zst'];

export type BackupFileLocation = {
    root: string;
    basePath: string;
    containerPrefix: string;
};

export type ServerBackupCreateResult = {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    mode?: string;
};

export type ServerBackupCreateOptions = {
    includeServerArtifact?: boolean;
};

function getOvhcloudBackupSupport(server: GameServerRow): OvhcloudBackupSupport {
    const support = getOvhcloudServerAdapter(server).backup;
    if (!support) {
        throw Object.assign(new Error('Backups are not supported for this OVHcloud image'), { statusCode: 501 });
    }
    return support;
}

export function getSupportedBackupExtensions(server: GameServerRow): string[] {
    if (nativeServerTemplate(server)) return ['.tar.gz'];
    if (server.provider === 'linuxgsm') {
        getLinuxGsmMetadata(server);
        return LINUXGSM_BACKUP_EXTENSIONS;
    }

    if (server.provider === 'ovhcloud') {
        return getOvhcloudBackupSupport(server).extensions;
    }

    throw Object.assign(new Error('Backups are not supported for external servers'), { statusCode: 501 });
}

export async function getBackupFileLocation(server: GameServerRow): Promise<BackupFileLocation> {
    if (nativeServerTemplate(server)) {
        await nativeBackupDirectory(server);
        return { root: 'native-backups', basePath: '/', containerPrefix: '' };
    }
    if (server.provider === 'linuxgsm') {
        getLinuxGsmMetadata(server);
        return {
            root: 'backup',
            basePath: '/',
            containerPrefix: '/app/lgsm/backup',
        };
    }

    if (server.provider === 'ovhcloud') {
        const support = getOvhcloudBackupSupport(server);
        if (support.resolveLocation) {
            return support.resolveLocation(server);
        }
        return support.location;
    }

    throw Object.assign(new Error('Backups are not supported for external servers'), { statusCode: 501 });
}

export function getBackupKind(server: GameServerRow): 'archive' | 'directory' | 'file-pair' {
    if (server.provider === 'ovhcloud') {
        return getOvhcloudBackupSupport(server).kind ?? 'archive';
    }

    return 'archive';
}

export function getBackupFilePair(server: GameServerRow): OvhcloudBackupFilePair {
    const filePair = server.provider === 'ovhcloud' ? getOvhcloudBackupSupport(server).filePair : undefined;
    if (!filePair) {
        throw Object.assign(new Error('File-pair backups are not supported for this server'), { statusCode: 501 });
    }
    return filePair;
}

function getBackupDirectory(server: GameServerRow): OvhcloudBackupDirectory | undefined {
    return server.provider === 'ovhcloud' ? getOvhcloudBackupSupport(server).directory : undefined;
}

export function listBackupDirectories(server: GameServerRow, entries: FsEntry[]): FsEntry[] {
    const directory = getBackupDirectory(server);
    return entries.filter((entry) => (
        entry.type === 'dir' && (!directory || directory.isBackup(entry.name))
    ));
}

export function assertSupportedBackupDirectory(server: GameServerRow, name: string): void {
    const directory = getBackupDirectory(server);
    if (directory && !directory.isBackup(name)) {
        throw Object.assign(new Error(`'${name}' is not a backup`), { statusCode: 400 });
    }
}

export function assertSupportedBackupArchive(server: GameServerRow, name: string): void {
    const extensions = getSupportedBackupExtensions(server);
    if (!extensions.some((extension) => name.endsWith(extension))) {
        throw Object.assign(new Error(`Unsupported backup archive extension for ${server.provider} server`), { statusCode: 400 });
    }
}

export async function createServerBackup(
    server: GameServerRow & { docker_container_id: string },
    options: ServerBackupCreateOptions = {}
): Promise<ServerBackupCreateResult> {
    if (nativeServerTemplate(server)) return createNativeBackup(server);
    if (server.provider === 'linuxgsm') {
        const linuxgsm = getLinuxGsmMetadata(server);
        const containerStatus = await dockerUtils.checkContainerStatus(server.docker_container_id);
        if (containerStatus !== 'running') {
            throw Object.assign(new Error('LinuxGSM backups can only be created while the container is running'), { statusCode: 409 });
        }

        const result = await dockerUtils.execShellCommand(
            server.docker_container_id,
            `/app/${linuxgsm.gameservername} backup`,
            { user: 'linuxgsm', workdir: '/app' }
        );

        return {
            ok: result.exitCode === 0,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
        };
    }

    if (server.provider === 'ovhcloud') {
        return createOvhcloudBackup(server, options);
    }

    throw Object.assign(new Error('Backups are not supported for external servers'), { statusCode: 501 });
}

async function createOvhcloudBackup(
    server: GameServerRow & { docker_container_id: string },
    options: Record<string, unknown> = {}
): Promise<OvhcloudBackupCreateResult> {
    const support = getOvhcloudBackupSupport(server);

    if (!support.create) {
        throw Object.assign(
            new Error(support.createUnsupportedMessage ?? 'Backup creation is not supported for this OVHcloud image'),
            { statusCode: 501 }
        );
    }

    return support.create(server, options);
}

export async function restoreOvhcloudBackup(
    server: GameServerRow & { docker_container_id: string },
    input: OvhcloudBackupRestoreInput
): Promise<OvhcloudBackupRestoreResult> {
    const support = getOvhcloudBackupSupport(server);

    if (!support.restore) {
        throw Object.assign(new Error('Restore is not supported for this OVHcloud image'), { statusCode: 501 });
    }

    return support.restore(server, input);
}
