import { Router } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { API_SCOPES, type ApiScope, type ApiTokenStore } from '../services/apiTokens.js';

type Dependencies = {
    store: () => ApiTokenStore;
    permissions: (serverId: string, user: NonNullable<AuthenticatedRequest['user']>) => Promise<string[] | null>;
};
/** Mount behind session auth on the panel only. API bearer tokens cannot manage credentials. */
export function apiTokenManagement({ store, permissions }: Dependencies) {
    const router = Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.get('/', async (req: AuthenticatedRequest, res) => {
        if (!req.user || req.user.delegation) { res.sendStatus(401); return; }
        try { res.json({ tokens: await store().list(req.user.userId) }); }
        catch { res.status(500).json({ error: 'Could not load API tokens' }); }
    });
    router.post('/', async (req: AuthenticatedRequest, res) => {
        if (!req.user || req.user.delegation) { res.sendStatus(401); return; }
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(body.name) ||
            !Array.isArray(body.scopes) || !body.scopes.length || body.scopes.length > API_SCOPES.length ||
            !body.scopes.every((scope: unknown) => API_SCOPES.includes(scope as ApiScope)) ||
            !Array.isArray(body.serverIds) || !body.serverIds.length || body.serverIds.length > 100 ||
            !body.serverIds.every((id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ||
            !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now() || body.expiresAt > Date.now() + 365 * 86400000) {
            res.status(400).json({ error: 'Provide a name, expiry within one year, scopes and specific server IDs' }); return;
        }
        try {
            for (const id of new Set<string>(body.serverIds.map((id: string) => id.toLowerCase()))) {
                const current = await permissions(id, req.user);
                if (current === null || body.scopes.some((scope: string) =>
                    (scope === 'backups.read' || scope === 'backups.create') && !current.includes(scope))) {
                    res.status(403).json({ error: 'Requested token access exceeds your server permissions' }); return;
                }
            }
            res.status(201).json(await store().create(req.user.userId, body));
        } catch { res.status(500).json({ error: 'Could not create API token' }); }
    });
    router.delete('/:id', async (req: AuthenticatedRequest, res) => {
        if (!req.user || req.user.delegation) { res.sendStatus(401); return; }
        try {
            if (!await store().revoke(req.user.userId, req.params.id)) { res.sendStatus(404); return; }
            res.sendStatus(204);
        } catch { res.status(500).json({ error: 'Could not revoke API token' }); }
    });
    return router;
}
