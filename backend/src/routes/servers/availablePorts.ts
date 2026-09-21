import { serverRepository } from '../../database/index.js';
import { PERMISSIONS } from '../../permissions.js';
import { parseStoredPorts } from '../../providers/runtimeConfig.js';
import { availablePublicPorts } from '../../services/templatePortAllocation.js';
import { reservedHostBindings } from '../../services/hostPortAvailability.js';
import { globalSettings } from '../../services/globalSettings.js';
import { Router } from 'express';
import { rootOnly, requireServerPermission } from '../../middleware/auth.js';
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
    router.get('/:id/available-ports', requireServerPermission(PERMISSIONS.server.edit), async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const server = await serverRepository.findById(Number(req.params.id));
            if (!server) return res.status(404).json({ error: 'Server not found' });
            const saved = parseStoredPorts(server);
            if (![...saved.tcp, ...saved.udp].some(p => (p.hostIp || '0.0.0.0') === req.query.ip)) return res.status(400).json({ error: 'Select the assigned server IP' });
            const occupied = await reservedHostBindings(server.id, server.docker_container_id ? [server.docker_container_id] : []);
            const ports = availablePublicPorts(globalSettings().snapshot().network, occupied, req.query.ip, req.query.protocol);
            return res.json({ ports, checkedAt: new Date().toISOString() });
        } catch (error) {
            return sendRouteError(res, error, { route: 'ROUTE:SERVER:AVAILABLE_PORTS', fallbackMessage: 'Cannot verify available ports' });
        }
    });
    return router;
}
