import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
    buildServerEnvVisibility,
    buildServerVisibility,
    userHasServerPermission,
} from '../../middleware/auth.js';
import { PERMISSIONS } from '../../permissions.js';
import { installProgressRepository, serverRepository } from '../../database/index.js';
import type { GameServerRow } from '../../types/gameServer.js';
import {
    redactServerEnv,
    serializeGameServerWithInstallProgress,
} from '../../utils/apiSerialization.js';
import { sendRouteError } from '../../utils/routeErrors.js';
import { parseServerId } from './shared.js';
import { inspectContainerRuntime } from '../../utils/docker.js';

export function createServerReadRoutes(): Router {
    const router = Router();

    // GET /api/servers
    router.get('/', async (req: AuthenticatedRequest, res: Response) => {
        try {
            const servers = await serverRepository.listAll();
            const canSeeEnv = await buildServerEnvVisibility(req.user);
            const canSee = await buildServerVisibility(req.user);

            const serversWithInstall = await Promise.all(
                servers
                    .filter((server) => canSee(server.id))
                    .map(async (server: GameServerRow) => {
                        const installProgress = await installProgressRepository.getByServerId(
                            server.id,
                        );
                        const serialized = serializeGameServerWithInstallProgress(
                            server,
                            installProgress,
                        );
                        return canSeeEnv(server.id) ? serialized : redactServerEnv(serialized);
                    }),
            );

            res.json({ servers: serversWithInstall });
        } catch (error) {
            return sendRouteError(res, error, {
                route: 'ROUTE:SERVERS:LIST',
                fallbackMessage: 'Failed to fetch servers',
            });
        }
    });

    // GET /api/servers/:id
    router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
        try {
            const serverId = parseServerId(req.params.id);
            if (!serverId) {
                return res.status(400).json({ error: 'Invalid server id' });
            }

            const server = await serverRepository.findById(serverId);
            if (!server || !(await buildServerVisibility(req.user))(serverId)) {
                return res.status(404).json({ error: 'Server not found' });
            }

            const canSeeEnv = await userHasServerPermission(
                req.user,
                serverId,
                PERMISSIONS.server.env,
            );
            const serialized = serializeGameServerWithInstallProgress(server, await installProgressRepository.getByServerId(serverId));
            const runtime = server.docker_container_id
                ? await inspectContainerRuntime(server.docker_container_id).catch(() => null)
                : null;
            const started = Date.parse(runtime?.startedAt ?? '');
            const uptimeSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : null;

            return res.json({
                server: { ...(canSeeEnv ? serialized : redactServerEnv(serialized)), uptimeSeconds },
            });
        } catch (error) {
            return sendRouteError(res, error, {
                route: 'ROUTE:SERVERS:GET',
                fallbackMessage: 'Failed to fetch server',
                logContext: { serverId: req.params.id },
            });
        }
    });

    return router;
}
