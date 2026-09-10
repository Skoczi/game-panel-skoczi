import { Router, type Response } from 'express';
import { actionsRepository, serverRepository } from '../../../../database/index.js';
import { type AuthenticatedRequest, requireServerPermission } from '../../../../middleware/auth.js';
import type { GameServerRow } from '../../../../types/gameServer.js';
import { requireBodyObject, requirePositiveInt } from '../../../../utils/httpValidation.js';
import { sendRouteError } from '../../../../utils/routeErrors.js';
import { PERMISSIONS } from '../../../../permissions.js';
import { createScopedFileAreaRouter } from '../../../../routes/scopedFileArea.js';
import { getOvhcloudRustMetadata } from '../../../serverMetadata.js';
import { inspectRustFrameworks, runRustFrameworkScript } from './service.js';

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

    return server as GameServerWithContainer;
}

// GET /api/servers/:id/rust/frameworks
router.get('/frameworks', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const frameworks = await inspectRustFrameworks(server);
        return res.json({ frameworks });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:RUST:FRAMEWORKS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to inspect Rust frameworks',
        });
    }
});

// POST /api/servers/:id/rust/oxide/install
router.post('/oxide/install', requireServerPermission(PERMISSIONS.rust.frameworksWrite), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = optionalBodyObject(req.body);

        const server = await getServerOrThrow(serverId);
        await actionsRepository.create(serverId, 'info', 'Rust Oxide install requested', req.user?.username || '');

        const result = await runRustFrameworkScript(server, 'install-oxide', {
            version: getOptionalString(body, 'version'),
        });

        await actionsRepository.create(
            serverId,
            result.ok ? 'success' : 'error',
            result.ok ? 'Rust Oxide installed' : `Rust Oxide install failed (exitCode=${result.exitCode})`,
            req.user?.username || ''
        );

        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:RUST:OXIDE_INSTALL',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to install Rust Oxide',
        });
    }
});

// /api/servers/:id/rust/mods  (Oxide plugins file area)
router.use('/mods', createScopedFileAreaRouter({
    permissions: {
        read: PERMISSIONS.rust.mods.read,
        write: PERMISSIONS.rust.mods.write,
    },
    routeName: 'ROUTE:RUST:MODS',
    resolveArea(server) {
        getOvhcloudRustMetadata(server);
        return {
            root: 'data',
            basePath: '/server/oxide/plugins',
            kind: 'mods',
        };
    },
}));

export default router;
