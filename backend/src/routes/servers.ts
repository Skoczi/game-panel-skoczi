import { nativeGameConfigRoutes } from './nativeGameConfig.js';
import { gameMonitoringRoutes } from './gameMonitoring.js';
import { fastDownloadRoutes } from './fastDownload.js';
import { createAvailableCpuRoutes } from './servers/availableCpus.js';
import { Router } from 'express';
import serverFileRoutes from './serverFile.js';
import serverFilesRoutes from './serverFiles.js';
import backupsRoutes from './backups.js';
import wipeRoutes from './wipe.js';
import terminalRoutes from './terminal.js';
import scheduledTasksRoutes from './scheduledTasks.js';
import consoleRoutes from './console.js';
import ovhcloudRoutes from '../providers/ovhcloud/routes.js';
import { createServerDeleteRoutes } from './servers/delete.js';
import { createServerInstallRoutes } from './servers/install.js';
import { createServerInteractionRoutes } from './servers/interactions.js';
import { createServerMetricsRoutes } from './servers/metrics.js';
import { createServerPatchRoutes } from './servers/patch.js';
import { createServerPowerRoutes } from './servers/power.js';
import { createServerReadRoutes } from './servers/read.js';
import { buildServerVisibility, type AuthenticatedRequest } from '../middleware/auth.js';
import { enterServerMutation } from '../services/nativeOperationLock.js';
import { createNativeUpdateRoutes } from './servers/nativeUpdate.js';
import { createAvailablePortRoutes } from './servers/availablePorts.js';

const router = Router();
// Check membership before reporting mutation conflicts or acquiring locks.
router.use('/:id', (req: AuthenticatedRequest, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    void buildServerVisibility(req.user)
        .then((canSee) => {
            if (!canSee(Number(req.params.id))) res.status(404).json({ error: 'Server not found' });
            else next();
        })
        .catch(next);
});
// Serialize mutations from HTTP clients, including files, against native maintenance.
router.use('/:id', (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    try {
        const release = enterServerMutation(Number(req.params.id));
        const end = res.end;
        res.end = function (this: typeof res, ...args: any[]) {
            try { return (end as any).apply(this, args); }
            finally { release(); }
        } as typeof res.end;
        next();
    } catch (error) { res.status(409).json({ error: (error as Error).message }); }
});
// /api/servers/:id/file
router.use('/:id/game-config', nativeGameConfigRoutes);
router.use('/:id/monitoring', gameMonitoringRoutes);
router.use('/:id/fastdownload', fastDownloadRoutes);
router.use('/:id/file', serverFileRoutes);
// /api/servers/:id/files
router.use('/:id/files', serverFilesRoutes);
// /api/servers/:id/backups
router.use('/:id/backups', backupsRoutes);
// /api/servers/:id/wipe
router.use('/:id/wipe', wipeRoutes);
// /api/servers/:id/terminal
router.use('/:id/terminal', terminalRoutes);
// /api/servers/:id/console
router.use('/:id/console', consoleRoutes);
// /api/servers/:id/scheduled-tasks
router.use('/:id/scheduled-tasks', scheduledTasksRoutes);

// GET /api/servers/metrics and /api/servers/:id/metrics
router.use('/', createServerMetricsRoutes());

// /api/servers
router.use('/', createAvailablePortRoutes());
router.use('/', createAvailableCpuRoutes());
router.use('/', createServerReadRoutes());
// POST /api/servers/install
router.use('/', createServerInstallRoutes());
// PATCH /api/servers/:id
router.use('/', createServerPatchRoutes());
// POST /api/servers/:id/start|stop|restart
router.use('/', createServerPowerRoutes());
router.use('/', createNativeUpdateRoutes());
// POST /api/servers/:id/install/interactions/:interactionId/respond
router.use('/', createServerInteractionRoutes());
// DELETE /api/servers/:id
router.use('/', createServerDeleteRoutes());

// /api/servers/:id/{provider-route}
router.use('/:id', ovhcloudRoutes);

export default router;
