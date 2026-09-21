import path from 'node:path';
import { getServerStoragePaths } from '../utils/storage.js';
import { prepareFileHistory, commitFileHistory, listFileHistory, readFileHistory, type FileHistoryRecord } from '../services/fileHistory.js';
import { Router, type Response } from 'express';
import { type AuthenticatedRequest, requireServerPermission } from '../middleware/auth.js';
import { resolveServerPath } from '../services/fileExplorer.js';
import { rejectPrivateFileRoots } from '../middleware/privateFileRoots.js';
import { ensureIsFile, getBasenameFromApiPath, guessContentTypeByName } from '../utils/fsBrowser.js';
import { promises as fs } from 'node:fs';
import { sendRouteError } from '../utils/routeErrors.js';
import { PERMISSIONS } from '../permissions.js';
import {
    optionalQueryString,
    requireBodyObject,
    requirePositiveInt,
    requireString,
} from '../utils/httpValidation.js';

import { atomicFileWrite, fileVersion, MAX_INLINE_FILE_SIZE } from '../services/atomicFile.js';

const router = Router({ mergeParams: true });
router.use(rejectPrivateFileRoots);

function getQueryRoot(value: unknown): string | undefined {
    return optionalQueryString(value as string | string[] | undefined);
}

router.get('/history', requireServerPermission(PERMISSIONS.fs.read), async (req, res) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
        const apiPath = optionalQueryString(req.query.path) ?? '';
        if (!apiPath) return res.status(400).json({ error: 'Missing path' });
        const resolved = await resolveServerPath({ serverId, root: getQueryRoot(req.query.root), path: apiPath });
        await ensureIsFile(resolved.absPath, resolved.rootDir);
        const directory = path.join(getServerStoragePaths(serverId).serverRoot, '.file-history');
        const scope = { root: resolved.root, path: resolved.apiPath };
        const entryId = optionalQueryString(req.query.entry);
        res.setHeader('Cache-Control', 'no-store');
        return res.json(entryId ? { entry: await readFileHistory(directory, scope, entryId) } : { entries: await listFileHistory(directory, scope) });
    } catch (error) { sendRouteError(res, error, { route: 'FILE:HISTORY', fallbackMessage: 'Unable to read file history' }); }
});

// GET /api/servers/:id/file
router.get('/', requireServerPermission(PERMISSIONS.fs.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');

        const apiPath = optionalQueryString(req.query.path) ?? '';
        if (!apiPath) return res.status(400).json({ error: 'Missing path' });

        const root = getQueryRoot(req.query.root);

        const resolved = await resolveServerPath({ serverId, root, path: apiPath });
        await ensureIsFile(resolved.absPath, resolved.rootDir);

        const filename = getBasenameFromApiPath(resolved.apiPath);

        const stat = await fs.stat(resolved.absPath);
        if (stat.size > MAX_INLINE_FILE_SIZE) {
            return res.status(413).json({
                error: 'File too large to display',
                maxInlineSize: MAX_INLINE_FILE_SIZE,
                size: stat.size,
                hint: 'Use download instead',
            });
        }

        // Inline/open
        res.setHeader('Content-Type', guessContentTypeByName(filename));
        const content = await fs.readFile(resolved.absPath);
        if (content.length > MAX_INLINE_FILE_SIZE) return res.status(413).json({ error: 'File too large' });
        res.setHeader('ETag', fileVersion(content));
        res.setHeader('Cache-Control', 'no-store');
        return res.send(content);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:FILE:READ',
            fallbackMessage: 'Failed to read file',
            logContext: { serverId: req.params.id },
        });
    }
});

// PUT /api/servers/:id/file
router.put('/', requireServerPermission(PERMISSIONS.fs.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');

        const apiPath = optionalQueryString(req.query.path) ?? '';
        if (!apiPath) return res.status(400).json({ error: 'Missing path' });
        const root = getQueryRoot(req.query.root);
        const body = requireBodyObject(req.body);

        const content = requireString(body.content, 'Missing content');

        const resolved = await resolveServerPath({ serverId, root, path: apiPath });
        await ensureIsFile(resolved.absPath, resolved.rootDir);

        const historyDirectory = path.join(getServerStoragePaths(serverId).serverRoot, '.file-history');
        let record: FileHistoryRecord | undefined;
        let historyWarning: string | undefined;
        const version = await atomicFileWrite(resolved.absPath, content, typeof body.version === 'string' ? body.version : '', async previous => {
            try { record = await prepareFileHistory(historyDirectory, { root: resolved.root, path: resolved.apiPath }, req.user?.username || 'Unknown operator', previous, content); }
            catch { historyWarning = 'File saved without a history snapshot (512 KiB text limit, history quota or storage unavailable).'; }
        });
        if (record) {
            try { await commitFileHistory(historyDirectory, record); }
            catch { historyWarning = 'File saved, but completion could not be recorded in file history. The prior snapshot may be available as an unconfirmed save.'; }
        }
        return res.json({ ok: true, version, ...(historyWarning ? { historyWarning } : {}) });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:FILE:WRITE',
            fallbackMessage: 'Failed to write file',
            logContext: { serverId: req.params.id },
        });
    }
});

export default router;
