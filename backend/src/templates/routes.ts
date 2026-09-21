import { Router } from 'express';
import { rootOnly, type AuthenticatedRequest } from '../middleware/auth.js';
import { getDatabase } from '../database/init.js';
import { getConfig } from '../config.js';
import { nodes } from '../nodes/control.js';
import { TemplateStore } from './store.js';
import { TemplateError, validateTemplate } from './schema.js';
import { issueTemplateTicket } from './tickets.js';
let store: TemplateStore;
export async function initializeTemplates() {
    store = new TemplateStore(await getDatabase());
    await store.initialize();
}
export const templateRoutes = Router();
templateRoutes.use(rootOnly);
const route = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: AuthenticatedRequest, res: any) => {
    void fn(req, res).catch(error => res.status(error instanceof TemplateError ? error.statusCode : 500).json({ error: error instanceof TemplateError ? error.message : 'Template operation failed' }));
};
templateRoutes.get('/', route(async (_req, res) => res.json({ templates: await store.list() })));
templateRoutes.delete('/:id', route(async (req, res) => res.json(await store.remove(req.params.id, req.user!.username))));
templateRoutes.post('/validate', route(async (req, res) => res.json({ document: validateTemplate(req.body?.document) })));
templateRoutes.post('/', route(async (req, res) => res.status(201).json(await store.create(req.body?.document, req.user!.username))));
templateRoutes.post('/:id/versions', route(async (req, res) => {
    const version = req.body?.baseVersion;
    if (!Number.isSafeInteger(version) || version < 1) throw new TemplateError('Expected baseVersion');
    res.status(201).json(await store.create(req.body.document, req.user!.username, req.params.id, version));
}));
templateRoutes.get('/:id/:version/export', route(async (req, res) => {
    const row = await store.get(req.params.id, Number(req.params.version));
    res.setHeader('Content-Disposition', 'attachment; filename="game-template.json"');
    res.json(row.document);
}));
templateRoutes.post('/:id/:version/status', route(async (req, res) => {
    if (!['published', 'disabled'].includes(req.body?.status)) throw new TemplateError('Invalid status');
    res.json(await store.status(req.params.id, Number(req.params.version), req.body.status, req.user!.username));
}));
templateRoutes.post('/:id/:version/prepare', route(async (req, res) => {
    const row = await store.get(req.params.id, Number(req.params.version));
    if (row.status !== 'published') throw new TemplateError('Publish this template version before installing', 409);
    const nodeId = req.body?.nodeId;
    let key = getConfig().jwtSecret;
    if (nodeId !== 'local') {
        if (typeof nodeId !== 'string') throw new TemplateError('Select a node');
        const node = await nodes().get(nodeId);
        if (!node?.enabled || !node.key_encrypted) throw new TemplateError('Node must be enrolled and enabled', 409);
        key = nodes().key(node);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ticket: issueTemplateTicket({ id: row.id, version: row.version, hash: row.hash, document: row.document }, key, nodeId), protocol: 1, expiresIn: 120 });
}));
