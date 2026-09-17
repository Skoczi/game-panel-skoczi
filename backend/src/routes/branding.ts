import { Router } from 'express';
import { globalSettings } from '../services/globalSettings.js';

const router = Router();
// Public by design: login needs branding before authentication. Never expose the
// full settings snapshot (allocations, assignments, or revision) on this route.
router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(globalSettings().snapshot().appearance);
});
export default router;
