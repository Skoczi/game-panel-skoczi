import { Router } from 'express';
import { requireServerPermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../permissions.js';
import { serverRepository } from '../database/index.js';
import { nativeGameConfig } from '../services/nativeGameConfig.js';
import { sendRouteError } from '../utils/routeErrors.js';
import { requirePositiveInt } from '../utils/httpValidation.js';

export const nativeGameConfigRoutes = Router({ mergeParams: true });
nativeGameConfigRoutes.get('/', requireServerPermission(PERMISSIONS.fs.read), async (req, res) => {
    try {
        const server = await serverRepository.findById(requirePositiveInt(req.params.id, 'Invalid server id'));
        if (!server) return res.status(404).json({ error: 'Server not found' });
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ definition: nativeGameConfig(server) });
    } catch (error) { return sendRouteError(res, error, { route: 'GAME_CONFIG:READ', fallbackMessage: 'Could not resolve the active game configuration' }); }
});
