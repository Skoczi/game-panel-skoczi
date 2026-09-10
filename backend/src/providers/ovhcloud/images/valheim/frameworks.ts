import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getOvhcloudValheimMetadata } from '../../../serverMetadata.js';
import type { GameServerRow } from '../../../../types/gameServer.js';
import * as dockerUtils from '../../../../utils/docker.js';
import { ensureServerMountDirs } from '../../../../utils/storage.js';
import type { NormalizedMount } from '../../../../utils/mounts.js';
import { getServerFsRoot } from '../../../../services/fileExplorer.js';
import { assertCanModifyFrameworks } from '../../../../services/serverActionPolicy.js';
import { getRuntimeOwnership, hasStoredMount, parseStoredMounts } from '../../../runtimeConfig.js';

type GameServerWithContainer = GameServerRow & {
    docker_container_id: string;
};

export type ValheimBepInExStatus = {
    installed: boolean;
};

export type ValheimBepInExInstallResult = {
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
};

const VALHEIM_SERVER_DIR = 'server';
const BEPINEX_PRELOADER_REL = path.join(VALHEIM_SERVER_DIR, 'BepInEx', 'core', 'BepInEx.Preloader.dll');
const DOORSTOP_LIBS_REL = path.join(VALHEIM_SERVER_DIR, 'doorstop_libs');

function assertValheimServer(server: GameServerRow): void {
    getOvhcloudValheimMetadata(server);
}

function assertDataMount(server: GameServerRow): NormalizedMount[] {
    const mounts = parseStoredMounts(server);
    if (!hasStoredMount(mounts, 'data', '/data')) {
        throw Object.assign(new Error('OVHcloud Valheim requires data -> /data mount'), { statusCode: 409 });
    }
    return mounts;
}

function normalizeVersion(value: string | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > 120 || /[\0\r\n]/.test(normalized)) {
        throw Object.assign(new Error('version is invalid'), { statusCode: 400 });
    }
    return normalized;
}

export async function inspectValheimBepInEx(server: GameServerWithContainer): Promise<ValheimBepInExStatus> {
    assertValheimServer(server);
    assertDataMount(server);

    const { rootDir } = await getServerFsRoot({ serverId: server.id, root: 'data' });

    const [preloader, doorstopLibs] = await Promise.all([
        fs.stat(path.join(rootDir, BEPINEX_PRELOADER_REL)).then((stat) => stat.isFile()).catch(() => false),
        fs.stat(path.join(rootDir, DOORSTOP_LIBS_REL)).then((stat) => stat.isDirectory()).catch(() => false),
    ]);

    return { installed: preloader && doorstopLibs };
}

export async function installValheimBepInEx(
    server: GameServerWithContainer,
    options: { version?: string | null } = {}
): Promise<ValheimBepInExInstallResult> {
    assertValheimServer(server);
    assertCanModifyFrameworks(server);
    const mounts = assertDataMount(server);

    const version = normalizeVersion(options.version);
    const cmd = ['/app/install-bepinex.sh'];
    if (version) cmd.push(version);

    const resolvedMounts = await ensureServerMountDirs(server.id, mounts, getRuntimeOwnership(server));

    const result = await dockerUtils.runOneShotContainer({
        image: server.docker_image_digest?.trim() || server.docker_image,
        namePrefix: `gamepanel-valheim-install-bepinex-${server.id}`,
        cmd,
        mounts: resolvedMounts,
        user: 'gameserver',
        workdir: '/app',
        labels: {
            'gamepanel.serverId': String(server.id),
            'gamepanel.job': 'valheim-install-bepinex',
        },
    });

    return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
