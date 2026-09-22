import { Router } from 'express';
import { requireServerPermission, type AuthenticatedRequest } from '../middleware/auth.js';
import { PERMISSIONS } from '../permissions.js';
import { getMonitoringSettings, configureMonitoring } from '../services/gameMonitoring.js';
import { sendRouteError } from '../utils/routeErrors.js';
export const gameMonitoringRoutes = Router({ mergeParams: true });
gameMonitoringRoutes.get('/', async (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await getMonitoringSettings(Number(req.params.id))); }
    catch (error) { sendRouteError(res, error, { route: 'MONITOR:READ', fallbackMessage: 'Cannot load game monitoring' }); }
});
gameMonitoringRoutes.patch('/', requireServerPermission(PERMISSIONS.server.edit), async (req: AuthenticatedRequest, res) => {
    try { res.json(await configureMonitoring(Number(req.params.id), req.body, req.user?.username || 'Unknown')); }
    catch (error) { sendRouteError(res, error, { route: 'MONITOR:CONFIGURE', fallbackMessage: 'Cannot save game monitoring' }); }
});
