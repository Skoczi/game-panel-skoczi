import { getOvhcloudValheimMetadata } from '../../../serverMetadata.js';
import type { GameServerRow } from '../../../../types/gameServer.js';
import * as dockerUtils from '../../../../utils/docker.js';
import { getBasenameFromApiPath } from '../../../../utils/fsBrowser.js';
import { ensureServerMountDirs } from '../../../../utils/storage.js';
import { getRuntimeOwnership, parseStoredMounts } from '../../../runtimeConfig.js';
import { OVHCLOUD_DOCKER_STOP_TIMEOUT_SECONDS } from '../../adapters/common.js';
import type {
    OvhcloudBackupDirectory,
    OvhcloudBackupLocation,
    OvhcloudBackupRestoreInput,
    OvhcloudBackupRestoreResult,
} from '../../adapters/types.js';

export const VALHEIM_WORLDS_API_PATH = '/save/worlds_local';

const BACKUP_MARKER = '_backup_auto-';

export const VALHEIM_BACKUP_LOCATION: OvhcloudBackupLocation = {
    root: 'data',
    basePath: VALHEIM_WORLDS_API_PATH,
    containerPrefix: '/data',
};

const NO_ARCHIVE_EXTENSIONS: string[] = [];

export const valheimBackupDirectory: OvhcloudBackupDirectory = {
    isBackup(name: string): boolean {
        return name.includes(BACKUP_MARKER);
    },
};

export async function restoreValheimBackup(
    server: GameServerRow & { docker_container_id: string },
    input: OvhcloudBackupRestoreInput
): Promise<OvhcloudBackupRestoreResult> {
    getOvhcloudValheimMetadata(server);

    const status = await dockerUtils.checkContainerStatus(server.docker_container_id);
    if (status !== 'running' && status !== 'created' && status !== 'exited' && status !== 'dead') {
        throw Object.assign(new Error(`Cannot restore while container status is ${status}`), { statusCode: 409 });
    }

    const shouldRestart = status === 'running';
    if (shouldRestart) {
        await dockerUtils.stopContainer(server.docker_container_id, OVHCLOUD_DOCKER_STOP_TIMEOUT_SECONDS);
    }

    const backupName = getBasenameFromApiPath(input.resolvedApiPath);
    const mounts = parseStoredMounts(server);
    const resolvedMounts = await ensureServerMountDirs(server.id, mounts, getRuntimeOwnership(server));

    const result = await dockerUtils.runOneShotContainer({
        image: server.docker_image_digest?.trim() || server.docker_image,
        namePrefix: `gamepanel-valheim-restore-${server.id}`,
        cmd: ['/app/restore.sh', backupName],
        mounts: resolvedMounts,
        user: 'gameserver',
        workdir: '/app',
        labels: {
            'gamepanel.serverId': String(server.id),
            'gamepanel.job': 'valheim-restore',
        },
    });

    const ok = result.exitCode === 0;
    let restarted = false;
    if (ok && shouldRestart) {
        await dockerUtils.startContainer(server.docker_container_id);
        restarted = true;
    }

    return {
        ok,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        restarted,
    };
}

export { NO_ARCHIVE_EXTENSIONS as VALHEIM_BACKUP_EXTENSIONS };
