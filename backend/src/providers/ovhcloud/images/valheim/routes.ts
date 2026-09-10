import { Router, type Response } from 'express';
import { actionsRepository, serverRepository } from '../../../../database/index.js';
import { type AuthenticatedRequest, requireServerPermission } from '../../../../middleware/auth.js';
import type { GameServerRow } from '../../../../types/gameServer.js';
import { requireBodyObject, requirePositiveInt } from '../../../../utils/httpValidation.js';
import { sendRouteError } from '../../../../utils/routeErrors.js';
import { PERMISSIONS } from '../../../../permissions.js';
import { createScopedFileAreaRouter } from '../../../../routes/scopedFileArea.js';
import { assertOvhcloudValheimServer } from '../valheim.js';
import { inspectValheimBepInEx, installValheimBepInEx } from './frameworks.js';

const router = Router({ mergeParams: true });

type GameServerWithContainer = GameServerRow & {
    docker_container_id: string;
};

function routeServerId(req: AuthenticatedRequest): number {
    return requirePositiveInt(req.params.id, 'Invalid server id');
}

function optionalBodyObject(body: unknown): Record<string, unknown> {
    return body === undefined ? {} : requireBodyObject(body);
}

function getOptionalString(body: Record<string, unknown>, key: string): string | null {
    const value = body[key];
    return typeof value === 'string' ? value : null;
}

async function getServerOrThrow(serverId: number): Promise<GameServerWithContainer> {
    const server = await serverRepository.findById(serverId);

    if (!server) {
        throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    }

    if (!server.docker_container_id) {
        throw Object.assign(new Error('Server has no container'), { statusCode: 400 });
    }

    assertOvhcloudValheimServer(server);
    return server as GameServerWithContainer;
}

// GET /api/servers/:id/valheim/frameworks
router.get('/frameworks', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const status = await inspectValheimBepInEx(server);
        return res.json({ bepinex: status });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:VALHEIM:FRAMEWORKS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to inspect Valheim mod loader',
        });
    }
});

// POST /api/servers/:id/valheim/bepinex/install
router.post('/bepinex/install', requireServerPermission(PERMISSIONS.valheim.frameworksWrite), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = optionalBodyObject(req.body);

        const server = await getServerOrThrow(serverId);
        await actionsRepository.create(serverId, 'info', 'Valheim BepInEx install requested', req.user?.username || '');

        const result = await installValheimBepInEx(server, {
            version: getOptionalString(body, 'version'),
        });

        await actionsRepository.create(
            serverId,
            result.ok ? 'success' : 'error',
            result.ok ? 'Valheim BepInEx installed' : `Valheim BepInEx install failed (exitCode=${result.exitCode})`,
            req.user?.username || ''
        );

        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:VALHEIM:BEPINEX_INSTALL',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to install Valheim BepInEx',
        });
    }
});

// /api/servers/:id/valheim/mods -> BepInEx plugins directory
router.use('/mods', createScopedFileAreaRouter({
    permissions: {
        read: PERMISSIONS.valheim.mods.read,
        write: PERMISSIONS.valheim.mods.write,
    },
    routeName: 'ROUTE:VALHEIM:MODS',
    resolveArea(server) {
        assertOvhcloudValheimServer(server);
        return {
            root: 'data',
            basePath: '/server/BepInEx/plugins',
            kind: 'mods',
        };
    },
}));

export default router;
