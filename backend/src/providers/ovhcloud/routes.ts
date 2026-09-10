import { Router } from 'express';
import { getKnownOvhcloudAdapters } from './adapters/registry.js';
import settingsRouter from './settings/router.js';

const router = Router({ mergeParams: true });

router.use('/settings', settingsRouter);

for (const adapter of getKnownOvhcloudAdapters()) {
    for (const route of adapter.routes ?? []) {
        // /api/servers/:id/{provider-route}
        router.use(route.path, route.router);
    }
}

export default router;
