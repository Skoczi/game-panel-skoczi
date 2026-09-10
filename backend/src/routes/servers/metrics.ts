import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { serverMetricsRepository, serverRepository } from '../../database/index.js';
import { METRICS_HISTORY_RAW_LIMIT, buildMetricsHistory } from '../../utils/metrics.js';
import { parseLimit } from '../../utils/number.js';
import { getServerMetricsSamples } from '../../utils/serverMetricsCache.js';
import { sendRouteError } from '../../utils/routeErrors.js';
import { parseServerId } from './shared.js';

export function createServerMetricsRoutes(): Router {
    const router = Router();

    // GET /api/servers/metrics
    router.get('/metrics', (_req: AuthenticatedRequest, res: Response) => {
        return res.json({ metrics: getServerMetricsSamples() });
    });

    // GET /api/servers/:id/metrics
    router.get('/:id/metrics', async (req: AuthenticatedRequest, res: Response) => {
        try {
            const serverId = parseServerId(req.params.id);
            if (!serverId) {
                return res.status(400).json({ error: 'Invalid server id' });
            }

            const server = await serverRepository.findById(serverId);
            if (!server) {
                return res.status(404).json({ error: 'Server not found' });
            }

            const limit = parseLimit(req.query.limit, 100, 2000);
            const raw = await serverMetricsRepository.getRecentForLastDays(serverId, 1, METRICS_HISTORY_RAW_LIMIT);
            const { points, meta } = buildMetricsHistory(raw, limit);

            return res.json({ serverId, metrics: points, limit, meta });
        } catch (error) {
            return sendRouteError(res, error, {
                route: 'ROUTE:SERVERS:METRICS',
                fallbackMessage: 'Failed to fetch server metrics',
                logContext: { serverId: req.params.id },
            });
        }
    });

    return router;
}
