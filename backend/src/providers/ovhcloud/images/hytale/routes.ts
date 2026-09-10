import { Router } from 'express';
import { PERMISSIONS } from '../../../../permissions.js';
import { createScopedFileAreaRouter } from '../../../../routes/scopedFileArea.js';
import { assertOvhcloudHytaleServer } from '../hytale.js';

const router = Router({ mergeParams: true });

// /api/servers/:id/hytale/mods
router.use('/mods', createScopedFileAreaRouter({
    permissions: {
        read: PERMISSIONS.hytale.mods.read,
        write: PERMISSIONS.hytale.mods.write,
    },
    routeName: 'ROUTE:HYTALE:MODS',
    resolveArea(server) {
        assertOvhcloudHytaleServer(server);
        return {
            root: 'data',
            basePath: '/game/Server/mods',
            kind: 'mods',
        };
    },
}));

export default router;
