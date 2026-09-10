import type { GameServerRow } from '../../../types/gameServer.js';
import { getOvhcloudValheimMetadata } from '../../serverMetadata.js';
import { normalizeEnvPayload } from '../../installPayload.js';

export const VALHEIM_IMAGE_ID = 'valheim';

export type OvhcloudValheimImage = {
    imageId: typeof VALHEIM_IMAGE_ID;
};

export function getOvhcloudValheimImage(imageId: string): OvhcloudValheimImage | null {
    return imageId === VALHEIM_IMAGE_ID
        ? { imageId: VALHEIM_IMAGE_ID }
        : null;
}

const MIN_PASSWORD_LENGTH = 5;

function lastEnvValue(env: string[], key: string): string | null {
    const prefix = `${key}=`;
    let value: string | null = null;
    for (const entry of env) {
        if (entry.startsWith(prefix)) value = entry.slice(prefix.length);
    }
    return value;
}

function invalidValheimEnv(message: string): never {
    throw Object.assign(new Error(message), { statusCode: 400 });
}

export function normalizeValheimEnv(payload: unknown): string[] {
    const env = normalizeEnvPayload(payload);

    const password = lastEnvValue(env, 'VALHEIM_SERVER_PASSWORD') ?? '';
    const publicValue = lastEnvValue(env, 'VALHEIM_PUBLIC') ?? '1';
    const isPublic = publicValue !== '0';

    if (password.length > 0 && password.length < MIN_PASSWORD_LENGTH) {
        invalidValheimEnv(`VALHEIM_SERVER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    if (isPublic && password.length === 0) {
        invalidValheimEnv(
            'A public Valheim server (VALHEIM_PUBLIC=1) requires VALHEIM_SERVER_PASSWORD (min 5 characters). '
            + 'Set a password, or set VALHEIM_PUBLIC=0 for a private (join-by-IP) server.'
        );
    }

    return env;
}

export function buildValheimProviderMetadata(
    image: OvhcloudValheimImage
): Record<string, unknown> {
    return {
        imageId: image.imageId,
        family: 'valheim',
        serverType: 'valheim',
        capabilities: {
            backup: {
                type: 'native-directory',
                supportsCreate: false,
            },
            restore: {
                type: 'script',
                script: '/app/restore.sh',
            },
            mods: {
                type: 'bepinex',
                installScript: '/app/install-bepinex.sh',
                pluginsPath: 'BepInEx/plugins',
            },
        },
    };
}

export function assertOvhcloudValheimServer(server: GameServerRow): void {
    getOvhcloudValheimMetadata(server);
}
