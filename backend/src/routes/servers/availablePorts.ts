import { Router } from 'express';
import { rootOnly } from '../../middleware/auth.js';
import { listAvailablePublicPorts } from '../../services/templatePortAllocation.js';
import { sendRouteError } from '../../utils/routeErrors.js';

export function createAvailablePortRoutes(): Router {
    const router = Router();
    router.get('/available-ports', rootOnly, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const ports = await listAvailablePublicPorts(req.query.ip, req.query.protocol);
            res.json({ ports, checkedAt: new Date().toISOString() });
        } catch (error) {
            sendRouteError(res, error, { route: 'ROUTE:SERVERS:AVAILABLE_PORTS', fallbackMessage: 'Cannot verify available ports on this node' });
        }
    });
    return router;
}
