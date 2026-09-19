import type { Request, Response, NextFunction } from 'express';

// Native backup archives use their own permission-checked routes, not fs grants.
export function rejectPrivateFileRoots(req: Request, res: Response, next: NextFunction) {
    for (const source of [req.query, req.body]) {
        for (const key of ['root', 'fromRoot', 'toRoot']) {
            const value = source?.[key];
            const values = Array.isArray(value) ? value : [value];
            if (values.some(v => typeof v === 'string' && v.trim() === 'native-backups')) return res.status(403).json({ error: 'Use the Backups API to access backup archives' });
        }
    }
    next();
}
