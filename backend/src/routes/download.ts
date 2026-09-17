import { Router, type Request, type Response } from 'express';
import { sendRouteError } from '../utils/routeErrors.js';
import { contentDispositionAttachment } from '../utils/fsBrowser.js';
import { consumeDownloadToken } from '../services/downloadTokens.js';
import {
    resolveDownloadTarget,
    streamDirectoryZip,
    streamFileDownload,
} from '../services/fileTransfers.js';
import { isAgent } from '../agent/identity.js';
import { serverRepository, userRepository } from '../database/index.js';
import { userHasServerPermission } from '../middleware/auth.js';
import { verifyToken, extractTokenFromHeader } from '../utils/auth.js';

const router = Router();

// GET /api/download/:token
router.get('/:token', async (req: Request, res: Response) => {
    const claim = consumeDownloadToken(req.params.token);
    if (!claim) {
        return res.status(404).json({ error: 'Invalid or expired download token' });
    }

    try {
        const server = await serverRepository.findById(claim.serverId);
        if (!server || server.runtime_uuid !== claim.runtimeKey)
            return res.status(403).json({ error: 'Download access revoked' });
        if (isAgent()) {
            const principal = verifyToken(extractTokenFromHeader(req.headers.authorization)!);
            if (
                (!principal.isRoot && principal.userId !== claim.userId) ||
                !(await userHasServerPermission(principal, claim.serverId, 'fs.read'))
            )
                return res.status(403).json({ error: 'Download access revoked' });
        } else {
            const user = await userRepository.findById(claim.userId);
            if (
                !user?.is_enabled ||
                user.token_version !== claim.tokenVersion ||
                !(await userHasServerPermission(
                    {
                        userId: user.id,
                        username: user.username,
                        isRoot: Boolean(user.is_root),
                        tokenVersion: user.token_version,
                    },
                    claim.serverId,
                    'fs.read',
                ))
            )
                return res.status(403).json({ error: 'Download access revoked' });
        }
        const target = await resolveDownloadTarget({
            serverId: claim.serverId,
            root: claim.root,
            path: claim.path,
        });

        res.setHeader('Content-Disposition', contentDispositionAttachment(target.filename));

        if (target.type === 'file') {
            res.setHeader('Content-Type', target.contentType ?? 'application/octet-stream');
            res.setHeader('Content-Length', String(target.size));
            await streamFileDownload({ target, output: res });
            return;
        }

        res.setHeader('Content-Type', 'application/zip');
        await streamDirectoryZip({ target, output: res });
    } catch (error) {
        if (res.headersSent) return res.end();
        return sendRouteError(res, error, {
            route: 'ROUTE:DOWNLOAD:TOKEN',
            fallbackMessage: 'Failed to download',
            logContext: { serverId: claim.serverId },
        });
    }
});

export default router;
