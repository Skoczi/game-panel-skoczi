import { getLinuxGsmGameForInstall } from '../../services/linuxGsmManifest.js';
import { normalizeMountsPayload } from '../../utils/mounts.js';
import { asOptionalString, normalizeEnvPayload } from '../installPayload.js';
import type { ProviderInstallContext, ResolvedInstallSpec } from '../installTypes.js';
import { getProviderRuntimeIdentity, runtimeConfigForIdentity } from '../runtimeIdentity.js';

function normalizeLinuxGsmEnv(payload: unknown): string[] {
    let env = normalizeEnvPayload(payload);

    if (!env.some((entry) => /^UPDATE_CHECK=.+/.test(entry))) {
        env = env.filter((entry) => !entry.startsWith('UPDATE_CHECK='));
        env.push('UPDATE_CHECK=0');
    }

    return env;
}

export async function resolveLinuxGsmInstallSpec(
    ctx: ProviderInstallContext
): Promise<ResolvedInstallSpec> {
    const shortname = asOptionalString(ctx.body.shortname)?.trim() || '';
    if (!shortname) {
        throw Object.assign(new Error('Missing LinuxGSM shortname'), { statusCode: 400 });
    }

    const game = await getLinuxGsmGameForInstall(shortname);
    const mounts = normalizeMountsPayload(ctx.body.mounts) ?? [];
    const runtimeIdentity = getProviderRuntimeIdentity('linuxgsm');

    return {
        provider: 'linuxgsm',
        catalogId: game.shortname,
        dockerImage: game.docker_image,
        ports: ctx.ports,
        healthcheck: ctx.healthcheck,
        resourceLimits: ctx.resourceLimits,
        mounts,
        env: normalizeLinuxGsmEnv(ctx.body.env),
        runtimeIdentity,
        runtimeConfig: runtimeConfigForIdentity(runtimeIdentity, '/data', '/app'),
        providerMetadata: {
            shortname: game.shortname,
            gameservername: game.gameservername,
            gamename: game.gamename,
            os: game.os,
        },
        steamCredentials: ctx.steamCredentials,
    };
}
