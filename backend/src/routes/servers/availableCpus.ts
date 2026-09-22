import { Router } from 'express';
import { rootOnly } from '../../middleware/auth.js';
import { availableCpus } from '../../services/cpuAssignments.js';
import { serverRepository } from '../../database/index.js';
import { sendRouteError } from '../../utils/routeErrors.js';

export function createAvailableCpuRoutes(): Router {
    const router = Router();
    router.get(['/available-cpus', '/:id/available-cpus'], rootOnly, async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            if (req.params.id && !await serverRepository.findById(Number(req.params.id))) return res.status(404).json({ error: 'Server not found' });
            return res.json(await availableCpus());
        } catch (error) { return sendRouteError(res, error, { route: 'ROUTE:CPU_BINDING', fallbackMessage: 'CPU binding is unavailable on this node' }); }
    });
    return router;
}
