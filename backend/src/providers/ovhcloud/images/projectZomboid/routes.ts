import { Router, type Response } from 'express';
import { actionsRepository, serverRepository } from '../../../../database/index.js';
import { type AuthenticatedRequest, requireServerPermission } from '../../../../middleware/auth.js';
import type { GameServerRow } from '../../../../types/gameServer.js';
import { requireBodyObject, requirePositiveInt } from '../../../../utils/httpValidation.js';
import { sendRouteError } from '../../../../utils/routeErrors.js';
import { PERMISSIONS } from '../../../../permissions.js';
import { assertOvhcloudProjectZomboidServer } from '../projectZomboid.js';
import {
    addProjectZomboidMods,
    fetchWorkshopMetadata,
    listProjectZomboidMods,
    removeProjectZomboidMod,
    reorderProjectZomboidMods,
    updateProjectZomboidMod,
} from './mods.js';

const router = Router({ mergeParams: true });

type GameServerWithContainer = GameServerRow & {
    docker_container_id: string;
};

function routeServerId(req: AuthenticatedRequest): number {
    return requirePositiveInt(req.params.id, 'Invalid server id');
}

function routeActor(req: AuthenticatedRequest): string {
    return req.user?.username || '';
}

async function getServerOrThrow(serverId: number): Promise<GameServerWithContainer> {
    const server = await serverRepository.findById(serverId);

    if (!server) {
        throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    }

    if (!server.docker_container_id) {
        throw Object.assign(new Error('Server has no container'), { statusCode: 400 });
    }

    assertOvhcloudProjectZomboidServer(server);
    return server as GameServerWithContainer;
}

// GET /api/servers/:id/project-zomboid/mods
router.get('/mods', requireServerPermission(PERMISSIONS.projectZomboid.mods.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const mods = await listProjectZomboidMods(server);
        return res.json({ mods });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:PROJECT_ZOMBOID:MODS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to list Project Zomboid mods',
        });
    }
});

// GET /api/servers/:id/project-zomboid/mods/workshop/:workshopId  (Steam preview; no stopped requirement)
router.get('/mods/workshop/:workshopId', requireServerPermission(PERMISSIONS.projectZomboid.mods.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        await getServerOrThrow(serverId);
        const item = await fetchWorkshopMetadata(req.params.workshopId);
        return res.json({ item });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:PROJECT_ZOMBOID:MODS_WORKSHOP_PREVIEW',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to fetch the Steam Workshop item',
        });
    }
});

// POST /api/servers/:id/project-zomboid/mods
router.post('/mods', requireServerPermission(PERMISSIONS.projectZomboid.mods.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const result = await addProjectZomboidMods(server, body.workshopIds ?? body.workshopId);

        const detail = [
            result.added.length ? `added: ${result.added.join(', ')}` : null,
            result.failed.length ? `failed: ${result.failed.join(', ')}` : null,
            result.skipped.length ? `already present: ${result.skipped.join(', ')}` : null,
        ].filter(Boolean).join('; ');
        await actionsRepository.create(serverId, 'success', `Project Zomboid mods (${detail || 'no change'})`, routeActor(req));

        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:PROJECT_ZOMBOID:MODS_ADD',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to add Project Zomboid mods',
        });
    }
});

// PUT /api/servers/:id/project-zomboid/mods/order
router.put('/mods/order', requireServerPermission(PERMISSIONS.projectZomboid.mods.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const mods = await reorderProjectZomboidMods(server, body.order);

        await actionsRepository.create(serverId, 'info', 'Project Zomboid mod order updated', routeActor(req));
        return res.json({ mods });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:PROJECT_ZOMBOID:MODS_REORDER',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to reorder Project Zomboid mods',
        });
    }
});

// PATCH /api/servers/:id/project-zomboid/mods/:workshopId
router.patch('/mods/:workshopId', requireServerPermission(PERMISSIONS.projectZomboid.mods.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const mods = await updateProjectZomboidMod(server, req.params.workshopId, {
            enabled: body.enabled,
            modIds: body.modIds,
        });

        await actionsRepository.create(serverId, 'info', `Project Zomboid mod updated: ${req.params.workshopId}`, routeActor(req));
        return res.json({ mods });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:PROJECT_ZOMBOID:MODS_UPDATE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to update Project Zomboid mod',
        });
    }
});

// DELETE /api/servers/:id/project-zomboid/mods/:workshopId
router.delete('/mods/:workshopId', requireServerPermission(PERMISSIONS.projectZomboid.mods.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const mods = await removeProjectZomboidMod(server, req.params.workshopId);

        await actionsRepository.create(serverId, 'info', `Project Zomboid mod removed: ${req.params.workshopId}`, routeActor(req));
        return res.json({ mods });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:PROJECT_ZOMBOID:MODS_REMOVE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to remove Project Zomboid mod',
        });
    }
});

export default router;
