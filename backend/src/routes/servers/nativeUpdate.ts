import { Router } from 'express';
import { rootOnly, type AuthenticatedRequest } from '../../middleware/auth.js';
import { startNativeUpdate } from '../../services/nativeUpdate.js';
import { sendRouteError } from '../../utils/routeErrors.js';

export function createNativeUpdateRoutes() {
    const router = Router();
    router.post('/:id/native-update', rootOnly, async (req: AuthenticatedRequest, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isSafeInteger(id) || id < 1 || req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm the update after taking a backup (confirm: true)' });
            await startNativeUpdate(id, req.user!.username);
            res.status(202).json({ success: true, message: 'Native update started. Follow Activity; the server will remain stopped.' });
        } catch (error) { sendRouteError(res, error, { route: 'NATIVE:UPDATE', fallbackMessage: 'Cannot update native server' }); }
    });
    return router;
}
