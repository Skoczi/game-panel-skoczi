import { Router, type Response, type ErrorRequestHandler } from 'express';
import type { ApiToken, ApiTokenStore } from '../services/apiTokens.js';
import { tokenAllows } from '../services/apiTokens.js';
import type { FleetRow } from '../fleet/store.js';
import { ApiRateLimit } from '../services/apiRateLimit.js';
import type { ApiOperationStore } from '../services/apiOperations.js';

type Owner = { userId: number; isRoot: boolean; enabled: boolean };
type Dependencies = {
    store: () => ApiTokenStore;
    owner: (id: number) => Promise<Owner | null>;
    servers: () => Promise<FleetRow[]>;
    permissions: (server: FleetRow, owner: Owner) => Promise<string[] | null>;
    resources?: (server: FleetRow, ownerId: number) => Promise<unknown>;
    backups?: (server: FleetRow, ownerId: number) => Promise<Array<{ name: string }>>;
    operations?: {
        store: () => ApiOperationStore;
        normalizeName: (name: unknown) => string;
        start: (server: FleetRow, ownerId: number, operationId: string, name: string) => Promise<string>;
        readJob: (server: FleetRow, ownerId: number, jobId: string) => Promise<{ status: string; startedAt: string | null; completedAt: string | null }>;
    };
};
function error(res: Response, status: number, code: string, message: string) {
    return res.status(status).json({ error: { code, message }, requestId: res.locals.requestId });
}
export const publicApiErrorHandler: ErrorRequestHandler = (cause, _req, res, _next) => {
    if (res.headersSent) { _next(cause); return; }
    const status = cause?.status === 413 ? 413 : cause?.status === 400 ? 400 : 500;
    res.setHeader('Cache-Control', 'no-store');
    error(res, status, status === 413 ? 'payload_too_large' : status === 400 ? 'invalid_request' : 'internal_error',
        status === 413 ? 'Request body exceeds the panel limit' : status === 400 ? 'Invalid JSON request body' : 'API request failed');
};
function serverDto(row: FleetRow) {
    return { id: row.id, number: row.server_number, name: row.name, provider: row.provider,
        status: row.status, observedAt: new Date(row.observed_at).toISOString() };
}

/** Deliberately separate from session authentication and internal runtime DTOs. */
export function publicApi(deps: Dependencies) {
    const router = Router();
    const sourceLimit = new ApiRateLimit(240), tokenLimit = new ApiRateLimit(120);
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.use((req, res, next) => {
        // Use the actual peer, never a caller-supplied forwarded header. Shared proxies share this budget.
        const rate = sourceLimit.take(req.socket.remoteAddress || 'unknown');
        if (!rate.allowed) {
            res.setHeader('Retry-After', rate.retryAfterSeconds);
            error(res, 429, 'rate_limited', 'Too many API requests'); return;
        }
        next();
    });
    router.use(async (req, res, next) => {
        try {
            const match = /^Bearer (gpp_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
            const token = match ? await deps.store().authenticate(match[1]) : null;
            const owner = token ? await deps.owner(token.ownerId) : null;
            if (!token || !owner?.enabled) { error(res, 401, 'unauthorized', 'Invalid or expired API token'); return; }
            const rate = tokenLimit.take(token.id);
            if (!rate.allowed) {
                res.setHeader('Retry-After', rate.retryAfterSeconds);
                error(res, 429, 'rate_limited', 'Too many requests for this token'); return;
            }
            res.locals.apiToken = token; res.locals.apiOwner = owner;
            next();
        } catch { error(res, 503, 'unavailable', 'API authentication unavailable'); }
    });
    router.get(['/servers', '/servers/:id'], async (req, res) => {
        const token = res.locals.apiToken as ApiToken, owner = res.locals.apiOwner as Owner;
        if (!token.scopes.includes('servers.read')) { error(res, 403, 'forbidden', 'Token requires servers.read'); return; }
        const rawLimit = req.query.limit ?? '50', after = req.query.after;
        if (typeof rawLimit !== 'string' || !/^[1-9]\d?$|^100$/.test(rawLimit) ||
            (after !== undefined && (typeof after !== 'string' || !/^[0-9a-f-]{36}$/.test(after)))) {
            error(res, 400, 'invalid_query', 'Use limit 1–100 and a server ID for after'); return;
        }
        try {
            const available = (await deps.servers()).filter(row => !row.missing && token.serverIds.includes(row.id))
                .sort((a, b) => a.id.localeCompare(b.id));
            const selected: FleetRow[] = [];
            for (const row of available) {
                if (req.params.id && row.id !== req.params.id) continue;
                if (after && row.id <= after) continue;
                const permissions = await deps.permissions(row, owner);
                if (tokenAllows(token, row.id, 'servers.read', { enabled: owner.enabled, permissions })) selected.push(row);
                if (!req.params.id && selected.length > Number(rawLimit)) break;
            }
            if (req.params.id && !selected.length) { error(res, 404, 'not_found', 'Server not found'); return; }
            await deps.store().markUsed(token.id);
            if (req.params.id) { res.json({ data: serverDto(selected[0]), requestId: res.locals.requestId }); return; }
            const page = selected.slice(0, Number(rawLimit));
            res.json({ data: page.map(serverDto), nextCursor: selected.length > page.length ? page[page.length - 1].id : null,
                requestId: res.locals.requestId });
        } catch { error(res, 503, 'unavailable', 'Server inventory unavailable'); }
    });
    router.get('/servers/:id/resources', async (req, res) => {
        const token = res.locals.apiToken as ApiToken, owner = res.locals.apiOwner as Owner;
        if (!token.scopes.includes('resources.read')) { error(res, 403, 'forbidden', 'Token requires resources.read'); return; }
        try {
            const row = (await deps.servers()).find(row => row.id === req.params.id && !row.missing);
            if (!row || !token.serverIds.includes(row.id) ||
                !tokenAllows(token, row.id, 'resources.read', { enabled: owner.enabled, permissions: await deps.permissions(row, owner) })) {
                error(res, 404, 'not_found', 'Server not found'); return;
            }
            if (!deps.resources) throw new Error('Resources unavailable');
            const data = await deps.resources(row, owner.userId);
            await deps.store().markUsed(token.id);
            res.json({ data, requestId: res.locals.requestId });
        } catch { error(res, 503, 'unavailable', 'Server resources unavailable; verify node connection and agent version'); }
    });
    router.get('/servers/:id/backups', async (req, res) => {
        const token = res.locals.apiToken as ApiToken, owner = res.locals.apiOwner as Owner;
        if (!token.scopes.includes('backups.read')) { error(res, 403, 'forbidden', 'Token requires backups.read'); return; }
        const rawLimit = req.query.limit ?? '50', after = req.query.after;
        if (typeof rawLimit !== 'string' || !/^[1-9]\d?$|^100$/.test(rawLimit) ||
            (after !== undefined && (typeof after !== 'string' || after.length > 255))) {
            error(res, 400, 'invalid_query', 'Use limit 1–100 and a backup name for after'); return;
        }
        try {
            const row = (await deps.servers()).find(row => row.id === req.params.id && !row.missing);
            if (!row || !token.serverIds.includes(row.id) ||
                !tokenAllows(token, row.id, 'backups.read', { enabled: owner.enabled, permissions: await deps.permissions(row, owner) })) {
                error(res, 404, 'not_found', 'Server not found'); return;
            }
            if (!deps.backups) throw new Error('Backups unavailable');
            const entries = (await deps.backups(row, owner.userId)).filter(entry => !after || entry.name > after);
            const page = entries.slice(0, Number(rawLimit));
            await deps.store().markUsed(token.id);
            res.json({ data: page, nextCursor: entries.length > page.length ? page[page.length - 1].name : null,
                requestId: res.locals.requestId });
        } catch { error(res, 503, 'unavailable', 'Backup inventory unavailable'); }
    });
    router.post('/servers/:id/backups', async (req, res) => {
        const token = res.locals.apiToken as ApiToken, owner = res.locals.apiOwner as Owner, operations = deps.operations;
        if (!token.scopes.includes('backups.create')) { error(res, 403, 'forbidden', 'Token requires backups.create'); return; }
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key) ||
            !req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== 'name')) {
            error(res, 400, 'invalid_request', 'Provide a JSON object with optional name and an Idempotency-Key of 16–128 letters, digits, hyphens or underscores'); return;
        }
        if (!operations) { error(res, 503, 'unavailable', 'Backup API unavailable'); return; }
        let name: string;
        try { name = operations.normalizeName(req.body.name); }
        catch { error(res, 400, 'invalid_name', 'Use a backup name of up to 64 letters, numbers, spaces, dots, hyphens or underscores, starting with a letter or number'); return; }
        try {
            const row = (await deps.servers()).find(row => row.id === req.params.id && !row.missing);
            if (!row || !token.serverIds.includes(row.id) ||
                !tokenAllows(token, row.id, 'backups.create', { enabled: owner.enabled, permissions: await deps.permissions(row, owner) })) {
                error(res, 404, 'not_found', 'Server not found'); return;
            }
            const admission = await operations.store().admit({ tokenId: token.id, ownerId: owner.userId, serverId: row.id,
                nodeId: row.node_id, runtimeId: row.runtime_id, runtimeKey: row.runtime_key, key, name });
            const operation = admission.operation;
            if (admission.conflict) { error(res, 409, 'idempotency_conflict', 'This key already belongs to a different backup request'); return; }
            res.setHeader('Location', `/api/v1/operations/${operation.id}`);
            if (!admission.fresh) res.setHeader('Idempotency-Replayed', 'true');
            if (admission.fresh) {
                try {
                    const jobId = await operations.start(row, owner.userId, operation.id, name);
                    await operations.store().started(operation.id, jobId);
                    operation.state = 'started';
                } catch {
                    await operations.store().uncertain(operation.id);
                    operation.state = 'uncertain';
                }
            }
            await deps.store().markUsed(token.id);
            const data = { id: operation.id, serverId: operation.server_id,
                status: operation.state === 'started' ? 'accepted' : operation.state === 'admitted' ? 'dispatching' : 'uncertain',
                createdAt: new Date(operation.created_at).toISOString() };
            res.status(operation.state === 'uncertain' ? 409 : 202).json({ data, requestId: res.locals.requestId,
                ...(operation.state === 'uncertain' ? { error: { code: 'outcome_uncertain', message: 'Dispatch was not confirmed. Inspect panel backup history before submitting a new key. This request will not be dispatched again.' } } : {}) });
        } catch { error(res, 503, 'unavailable', 'Backup admission unavailable. Retry only with the same Idempotency-Key.'); }
    });
    router.get('/operations/:id', async (req, res) => {
        const token = res.locals.apiToken as ApiToken, owner = res.locals.apiOwner as Owner, operations = deps.operations;
        if (!token.scopes.includes('operations.read')) { error(res, 403, 'forbidden', 'Token requires operations.read'); return; }
        if (!operations) { error(res, 503, 'unavailable', 'Operations API unavailable'); return; }
        try {
            const operation = await operations.store().get(req.params.id);
            const row = operation && operation.owner_id === owner.userId
                ? (await deps.servers()).find(row => row.id === operation.server_id && !row.missing) : undefined;
            const permissions = row ? await deps.permissions(row, owner) : null;
            if (!row || !operation || !permissions?.includes('backups.create') ||
                !tokenAllows(token, row.id, 'operations.read', { enabled: owner.enabled, permissions })) {
                error(res, 404, 'not_found', 'Operation not found'); return;
            }
            if (row.node_id !== operation.node_id || row.runtime_key !== operation.runtime_key || row.runtime_id !== operation.runtime_id) {
                error(res, 409, 'runtime_changed', 'The operation belongs to an earlier runtime placement'); return;
            }
            const job = operation.state === 'started' && operation.job_id ? await operations.readJob(row, owner.userId, operation.job_id) : null;
            await deps.store().markUsed(token.id);
            res.json({ data: { id: operation.id, serverId: row.id, createdAt: new Date(operation.created_at).toISOString(),
                status: job?.status ?? (operation.state === 'admitted' ? 'dispatching' : 'uncertain'),
                startedAt: job?.startedAt ?? null, completedAt: job?.completedAt ?? null }, requestId: res.locals.requestId });
        } catch { error(res, 503, 'unavailable', 'Operation status unavailable'); }
    });
    router.use((_req, res) => { error(res, 404, 'not_found', 'API endpoint not found'); });
    return router;
}
