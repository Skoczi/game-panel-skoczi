import { listServerBackups } from '../services/backupListing.js';
import { readNativeBackupPolicy, saveNativeBackupPolicy, validateBackupPolicy } from '../services/nativeBackupPolicy.js';
import { externalBackupDestination, listExternalBackups, importExternalBackup } from '../services/externalBackups.js';
import { planNativeRetention, applyNativeRetention } from '../services/nativeRetention.js';
import { inspectNativeProtection, readNativeBackupRecord, moveNativeBackupRecord } from '../services/nativeProtection.js';
import { getServerStoragePaths } from '../utils/storage.js';
import { backupCompatibility, legacyBackupPath } from '../services/backupCompatibility.js';
import { startBackupJob, listBackupJobs, readBackupJob } from '../services/backupJobs.js';
import { nativeServerTemplate, createNativeBackup, normalizeBackupName } from '../services/nativeBackups.js';
import { restoreNativeBackup } from '../services/nativeRestore.js';
import { Router, type Response } from 'express';
import { type AuthenticatedRequest, requireServerPermission } from '../middleware/auth.js';
import { getBackupSettings, setBackupSettings } from '../services/backupSettings.js';
import { resolveServerPath } from '../services/fileExplorer.js';
import { ensureIsDir, ensureIsFile, getBasenameFromApiPath, guessContentTypeByName } from '../utils/fsBrowser.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getServerOrThrow } from '../services/servers.js';
import { actionsRepository, scheduledTaskRepository } from '../database/index.js';
import { sendRouteError } from '../utils/routeErrors.js';
import {
    optionalNumber,
    optionalQueryString,
    optionalBoolean,
    requireBodyObject,
    requirePositiveInt,
} from '../utils/httpValidation.js';
import {
    assertSupportedBackupArchive,
    assertSupportedBackupDirectory,
    createServerBackup,
    getBackupFileLocation,
    getBackupFilePair,
    getBackupKind,
    restoreOvhcloudBackup,
} from '../services/serverBackups.js';
import { resolveDownloadTarget, streamDirectoryZip, streamFilesZip } from '../services/fileTransfers.js';
import { PERMISSIONS } from '../permissions.js';

const router = Router({ mergeParams: true });

router.get('/policy', requireServerPermission(PERMISSIONS.backups.read), async (req, res) => {
    try {
        const id = requirePositiveInt(req.params.id, 'Invalid server id');
        if (!nativeServerTemplate(await getServerOrThrow(id))) return res.status(400).json({ error: 'Backup policies require a Native server' });
        res.json({ policy: await readNativeBackupPolicy(id), destination: externalBackupDestination() });
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:POLICY', fallbackMessage: 'Unable to read backup settings' }); }
});
router.patch('/policy', requireServerPermission(PERMISSIONS.backups.settingsWrite), requireServerPermission(PERMISSIONS.backups.delete), async (req: AuthenticatedRequest, res) => {
    try {
        const id = requirePositiveInt(req.params.id, 'Invalid server id');
        const server = await getServerOrThrow(id);
        if (!nativeServerTemplate(server)) return res.status(400).json({ error: 'Backup policies require a Native server' });
        const input = validateBackupPolicy(req.body);
        if (input.externalCopy) await listExternalBackups(server); // Confirm destination before enabling it.
        const policy = await saveNativeBackupPolicy(id, input);
        await actionsRepository.create(id, 'info', `Backup policy updated: automatic retention ${policy.automaticRetention ? 'on' : 'off'}, external copy ${policy.externalCopy ? 'on' : 'off'}.`, req.user?.username || '');
        res.json({ policy, destination: externalBackupDestination() });
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:POLICY:SAVE', fallbackMessage: 'Unable to save backup settings' }); }
});
router.get('/external', requireServerPermission(PERMISSIONS.backups.read), async (req, res) => {
    try {
        const server = await getServerOrThrow(requirePositiveInt(req.params.id, 'Invalid server id'));
        if (!nativeServerTemplate(server)) return res.status(400).json({ error: 'External copies require a Native server' });
        res.json({ backups: await listExternalBackups(server) });
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:EXTERNAL:LIST', fallbackMessage: 'Unable to read external copies' }); }
});
router.post('/external/import', requireServerPermission(PERMISSIONS.backups.create), requireServerPermission(PERMISSIONS.backups.download), async (req: AuthenticatedRequest, res) => {
    try {
        const server = await getServerOrThrow(requirePositiveInt(req.params.id, 'Invalid server id'));
        if (!nativeServerTemplate(server)) return res.status(400).json({ error: 'External copies require a Native server' });
        const name = requireBodyObject(req.body).name;
        if (typeof name !== 'string' || path.basename(name) !== name || !name.startsWith('native-') || !name.endsWith('.tar.gz') || /[\\\x00-\x1f]/.test(name)) return res.status(400).json({ error: 'Invalid external backup name' });
        const job = await startBackupJob(server.id, 'import', req.user?.username || '', () => importExternalBackup(server, name));
        res.status(202).json({ job });
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:EXTERNAL:IMPORT', fallbackMessage: 'Unable to import external backup' }); }
});

router.get('/jobs', requireServerPermission(PERMISSIONS.backups.read), async (req, res) => {
    try { res.json({ jobs: await listBackupJobs(requirePositiveInt(req.params.id, 'Invalid server id')) }); }
    catch (error) { sendRouteError(res, error, { route: 'BACKUP:JOBS', fallbackMessage: 'Unable to load backup jobs' }); }
});

router.get('/jobs/:jobId', async (req: AuthenticatedRequest, res) => {
    try {
        const job = await readBackupJob(requirePositiveInt(req.params.id, 'Invalid server id'), req.params.jobId);
        await requireServerPermission(job.kind === 'restore' ? PERMISSIONS.backups.restore : PERMISSIONS.backups.create)(req, res, () => { res.json({job}); });
    } catch (error) { sendRouteError(res,error,{route:'BACKUP:JOB',fallbackMessage:'Unable to load operation status'}); }
});

router.get('/compatibility', requireServerPermission(PERMISSIONS.backups.read), async (req, res) => {
    try { res.json(await backupCompatibility(await getServerOrThrow(requirePositiveInt(req.params.id, 'Invalid server id')))); }
    catch (error) { sendRouteError(res, error, { route:'BACKUP:COMPATIBILITY', fallbackMessage:'Unable to inspect backup layout' }); }
});
router.get('/protection', requireServerPermission(PERMISSIONS.backups.read), async (req, res) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
        const server = await getServerOrThrow(serverId);
        if (!nativeServerTemplate(server)) return res.status(400).json({ error: 'Protection summary requires a Native server' });
        const [storage, tasks, jobs] = await Promise.all([
            inspectNativeProtection(getServerStoragePaths(serverId).dataDir),
            scheduledTaskRepository.listForServer(serverId).catch(() => null),
            listBackupJobs(serverId).catch(() => null),
        ]);
        // Expose only backup schedule health, never custom commands or their payloads.
        const backupTasks = tasks?.filter(task => task.type === 'backup');
        const schedules = backupTasks ? {
            total: backupTasks.length,
            enabled: backupTasks.filter(task => task.enabled).length,
            nextRunAt: backupTasks.filter(task => task.enabled && task.next_run_at).map(task => task.next_run_at!).sort()[0] || null,
            lastProblem: backupTasks.filter(task => task.enabled && ['failed', 'skipped'].includes(task.last_status || '')).length,
        } : null;
        const lastRestore = jobs?.find(job => job.kind === 'restore');
        return res.json({ ...storage, schedules, restoreHistoryAvailable: jobs !== null, lastRestore: lastRestore ? { status: lastRestore.status, startedAt: lastRestore.startedAt, completedAt: lastRestore.completedAt ?? null } : null });
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:PROTECTION', fallbackMessage: 'Unable to inspect data protection' }); }
});
router.get('/retention', requireServerPermission(PERMISSIONS.backups.delete), async (req, res) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
        const server = await getServerOrThrow(serverId);
        if (!nativeServerTemplate(server)) return res.status(400).json({ error: 'Cleanup requires a Native server' });
        res.json(await planNativeRetention(getServerStoragePaths(serverId).dataDir, { keepArchives: Number(req.query.keepArchives), keepRecovery: Number(req.query.keepRecovery) }));
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:RETENTION:PREVIEW', fallbackMessage: 'Unable to preview cleanup' }); }
});
router.post('/retention', requireServerPermission(PERMISSIONS.backups.delete), async (req: AuthenticatedRequest, res) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        if (!nativeServerTemplate(server)) return res.status(400).json({ error: 'Cleanup requires a Native server' });
        await actionsRepository.create(serverId, 'info', `Native cleanup requested: keep ${body.keepArchives} archives and ${body.keepRecovery} completed recovery directories`, req.user?.username || '');
        const result = await applyNativeRetention(getServerStoragePaths(serverId).dataDir, { keepArchives: body.keepArchives as number, keepRecovery: body.keepRecovery as number }, typeof body.fingerprint === 'string' ? body.fingerprint : '');
        await actionsRepository.create(serverId, 'info', `Native backup cleanup removed ${result.removed.length} item(s): ${result.removed.join(', ')}`, req.user?.username || '');
        res.json(result);
    } catch (error) { sendRouteError(res, error, { route: 'BACKUP:RETENTION', fallbackMessage: 'Could not confirm cleanup. Refresh the backup list before trying again.' }); }
});
router.get('/legacy/file', requireServerPermission(PERMISSIONS.backups.download), async (req, res) => {
    try {
        const server = await getServerOrThrow(requirePositiveInt(req.params.id, 'Invalid server id'));
        const name = typeof req.query.name === 'string' ? req.query.name : '';
        res.download(await legacyBackupPath(server,name), name);
    } catch (error) { sendRouteError(res,error,{route:'BACKUP:LEGACY',fallbackMessage:'Unable to download legacy archive'}); }
});

function joinApiPath(basePath: string, apiPath: string): string {
    const base = basePath.replace(/\/+$/, '') || '/';
    const child = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    if (base === '/') return child;
    return `${base}${child}`;
}

function normalizeBackupFilename(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const name = value.trim();
    if (!name || name.includes('\0')) return null;
    if (name.includes('/') || name.includes('\\')) return null;
    if (name === '.' || name === '..') return null;
    if (path.posix.basename(name) !== name) return null;

    return name;
}

async function resolveFilePairMembers(params: {
    serverId: number;
    location: { root: string; basePath: string };
    members: string[];
}): Promise<Array<{ absPath: string; rootDir: string; name: string }>> {
    const out: Array<{ absPath: string; rootDir: string; name: string }> = [];
    for (const member of params.members) {
        const resolved = await resolveServerPath({
            serverId: params.serverId,
            path: joinApiPath(params.location.basePath, member),
            root: params.location.root,
        });
        const st = await fs.lstat(resolved.absPath).catch(() => null);
        if (st?.isFile()) {
            out.push({ absPath: resolved.absPath, rootDir: resolved.rootDir, name: member });
        }
    }
    return out;
}

// GET /api/servers/:id/backups
router.get('/', requireServerPermission(PERMISSIONS.backups.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');

        return res.json(await listServerBackups(serverId));
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BACKUPS:LIST',
            fallbackMessage: 'Failed to list backups',
            logContext: { serverId: req.params.id },
        });
    }
});

// GET /api/servers/:id/backups/file
router.get('/file', requireServerPermission(PERMISSIONS.backups.download), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');

        const apiPath = optionalQueryString(req.query.path) ?? '';
        if (!apiPath) return res.status(400).json({ error: 'Missing path' });

        const download = String(req.query.download ?? '') === '1';

        const server = await getServerOrThrow(serverId);
        const kind = getBackupKind(server);
        const location = await getBackupFileLocation(server);

        if (kind === 'directory') {
            const backupName = normalizeBackupFilename(apiPath.replace(/^\/+/, ''));
            if (!backupName) return res.status(400).json({ error: 'Invalid backup name' });
            assertSupportedBackupDirectory(server, backupName);

            const target = await resolveDownloadTarget({
                serverId,
                root: location.root,
                path: joinApiPath(location.basePath, backupName),
            });

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${target.filename}"`);
            await streamDirectoryZip({ target, output: res });
            return;
        }

        if (kind === 'file-pair') {
            const backupName = normalizeBackupFilename(apiPath.replace(/^\/+/, ''));
            if (!backupName) return res.status(400).json({ error: 'Invalid backup name' });

            const members = await resolveFilePairMembers({
                serverId,
                location,
                members: getBackupFilePair(server).membersOf(backupName),
            });
            if (members.length === 0) return res.status(404).json({ error: 'Backup not found' });

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${backupName}.zip"`);
            await streamFilesZip({
                files: members.map((m) => ({ absPath: m.absPath, rootDir: m.rootDir, zipName: m.name })),
                output: res,
            });
            return;
        }

        const resolved = await resolveServerPath({
            serverId,
            path: joinApiPath(location.basePath, apiPath),
            root: location.root,
        });
        await ensureIsFile(resolved.absPath, resolved.rootDir);

        const filename = getBasenameFromApiPath(resolved.apiPath);
        assertSupportedBackupArchive(server, filename);

        if (download) return res.download(resolved.absPath, filename);

        res.setHeader('Content-Type', guessContentTypeByName(filename));
        return res.sendFile(resolved.absPath, { dotfiles: 'allow' });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BACKUPS:FILE_READ',
            fallbackMessage: 'Failed to read backup file',
            logContext: { serverId: req.params.id },
        });
    }
});

// PATCH /api/servers/:id/backups/file
router.patch('/file', requireServerPermission(PERMISSIONS.backups.rename), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
        const body = requireBodyObject(req.body);

        const apiPath = typeof body.path === 'string' ? body.path : '';
        if (!apiPath) return res.status(400).json({ error: 'Missing path' });

        const nextName = normalizeBackupFilename(body.name);
        if (!nextName) return res.status(400).json({ error: 'Invalid backup name' });

        const server = await getServerOrThrow(serverId);
        const kind = getBackupKind(server);
        if (kind === 'file-pair') {
            return res.status(400).json({ error: 'Renaming is not supported for this backup type' });
        }
        if (kind !== 'directory') {
            assertSupportedBackupArchive(server, nextName);
        }

        const location = await getBackupFileLocation(server);
        const source = await resolveServerPath({
            serverId,
            path: joinApiPath(location.basePath, apiPath),
            root: location.root,
        });

        if (kind === 'directory') {
            await ensureIsDir(source.absPath, source.rootDir);
        } else {
            await ensureIsFile(source.absPath, source.rootDir);
        }

        const currentName = getBasenameFromApiPath(source.apiPath);
        if (kind === 'directory') {
            assertSupportedBackupDirectory(server, currentName);
        } else {
            assertSupportedBackupArchive(server, currentName);
        }

        const targetRelativePath = path.posix.join(path.posix.dirname(apiPath || '/'), nextName);
        const target = await resolveServerPath({
            serverId,
            path: joinApiPath(location.basePath, targetRelativePath),
            root: location.root,
        });

        if (source.absPath === target.absPath) {
            return res.json({ success: true, path: apiPath.startsWith('/') ? apiPath : `/${apiPath}`, name: nextName });
        }

        const existingTarget = await fs.lstat(target.absPath).catch(() => null);
        if (existingTarget) {
            return res.status(409).json({ error: 'A backup with this name already exists' });
        }

        const record = nativeServerTemplate(server) ? await readNativeBackupRecord(source.absPath) : null;
        await fs.rename(source.absPath, target.absPath);
        if (record) await moveNativeBackupRecord(source.absPath, target.absPath, record).catch(() => {});
        await actionsRepository.create(
            serverId,
            'info',
            `Backup renamed: ${currentName} -> ${nextName}`,
            req.user?.username || ""
        );

        return res.json({
            success: true,
            path: targetRelativePath.startsWith('/') ? targetRelativePath : `/${targetRelativePath}`,
            name: nextName,
        });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BACKUPS:RENAME',
            fallbackMessage: 'Failed to rename backup',
            logContext: { serverId: req.params.id },
        });
    }
});

// GET /api/servers/:id/backups/settings
router.get('/settings', requireServerPermission(PERMISSIONS.backups.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');

        res.json(await getBackupSettings(serverId));
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BACKUPS:SETTINGS_READ',
            fallbackMessage: 'Failed to read backup settings',
            logContext: { serverId: req.params.id },
        });
    }
});

// POST /api/servers/:id/backups/create
router.post(
    ['/create', '/create-native'],
    requireServerPermission(PERMISSIONS.backups.create),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
            const body = req.body === undefined ? {} : requireBodyObject(req.body);

            const server = await getServerOrThrow(serverId);
            if (req.path === '/create-native' && !nativeServerTemplate(server))
                return res.status(400).json({ error: 'This endpoint requires a Native server' });
            await actionsRepository.create(serverId, 'info', 'Backup requested', req.user?.username || "");

            if (nativeServerTemplate(server)) {
                const name = normalizeBackupName(body.name);
                const job = await startBackupJob(serverId, 'backup', req.user?.username || '', () => createNativeBackup(server, true, name));
                return res.status(202).json({ job });
            }
            const result = await createServerBackup(server, {
                includeServerArtifact: optionalBoolean(body.includeServerArtifact, 'includeServerArtifact must be a boolean') ?? false,
            });

            await actionsRepository.create(
                serverId,
                result.ok ? 'success' : 'error',
                result.ok ? 'Backup completed' : `Backup failed (exitCode=${result.exitCode})`,
                req.user?.username || ""
            );

            return res.json(result);
        } catch (error) {
            return sendRouteError(res, error, {
                route: 'ROUTE:BACKUPS:CREATE',
                fallbackMessage: 'Backup failed',
                logContext: { serverId: req.params.id },
            });
        }
    }
);

// POST /api/servers/:id/backups/restore
router.post(
    '/restore',
    requireServerPermission(PERMISSIONS.backups.restore),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
            const body = requireBodyObject(req.body);

            const apiPath = typeof body.path === 'string' ? body.path : '';
            if (!apiPath) return res.status(400).json({ error: 'Missing path' });

            const server = await getServerOrThrow(serverId);
            if (nativeServerTemplate(server)) {
                await actionsRepository.create(serverId, 'info', `Native restore requested: ${apiPath}`, req.user?.username || '');
                const job = await startBackupJob(serverId, 'restore', req.user?.username || '', () => restoreNativeBackup(server, apiPath, true));
                return res.status(202).json({ job });
            }
            if (server.provider !== 'ovhcloud') {
                return res.status(501).json({ error: 'Restore is only supported for OVHcloud servers with restore support' });
            }

            const kind = getBackupKind(server);
            const location = await getBackupFileLocation(server);

            let resolvedApiPath: string;
            let filename: string;
            if (kind === 'directory') {
                const backupName = normalizeBackupFilename(apiPath.replace(/^\/+/, ''));
                if (!backupName) return res.status(400).json({ error: 'Invalid backup name' });
                assertSupportedBackupDirectory(server, backupName);
                const resolved = await resolveServerPath({
                    serverId,
                    path: joinApiPath(location.basePath, backupName),
                    root: location.root,
                });
                await ensureIsDir(resolved.absPath, resolved.rootDir);
                resolvedApiPath = resolved.apiPath;
                filename = backupName;
            } else if (kind === 'file-pair') {
                const backupName = normalizeBackupFilename(apiPath.replace(/^\/+/, ''));
                if (!backupName) return res.status(400).json({ error: 'Invalid backup name' });

                const members = await resolveFilePairMembers({
                    serverId,
                    location,
                    members: getBackupFilePair(server).membersOf(backupName),
                });
                if (members.length === 0) return res.status(404).json({ error: 'Backup not found' });

                resolvedApiPath = backupName;
                filename = backupName;
            } else {
                const resolved = await resolveServerPath({
                    serverId,
                    path: joinApiPath(location.basePath, apiPath),
                    root: location.root,
                });
                await ensureIsFile(resolved.absPath, resolved.rootDir);
                filename = getBasenameFromApiPath(resolved.apiPath);
                assertSupportedBackupArchive(server, filename);
                resolvedApiPath = resolved.apiPath;
            }

            await actionsRepository.create(serverId, 'info', `Restore requested: ${filename}`, req.user?.username || "");

            const result = await restoreOvhcloudBackup(server, {
                apiPath,
                resolvedApiPath,
                location,
            });

            await actionsRepository.create(
                serverId,
                result.ok ? 'success' : 'error',
                result.ok ? 'Restore completed' : `Restore failed (exitCode=${result.exitCode})`,
                req.user?.username || ""
            );

            return res.json(result);
        } catch (error) {
            return sendRouteError(res, error, {
                route: 'ROUTE:BACKUPS:RESTORE',
                fallbackMessage: 'Restore failed',
                logContext: { serverId: req.params.id },
            });
        }
    }
);

// PATCH /api/servers/:id/backups/settings
router.patch('/settings', requireServerPermission(PERMISSIONS.backups.settingsWrite), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');
        const body = requireBodyObject(req.body);

        const maxBackups = optionalNumber(body.maxBackups, 'maxBackups must be a number');
        const maxBackupDays = optionalNumber(body.maxBackupDays, 'maxBackupDays must be a number');
        const stopOnBackup = optionalBoolean(body.stopOnBackup, 'stopOnBackup must be a boolean');

        await setBackupSettings(serverId, {
            ...(maxBackups !== undefined ? { maxBackups } : {}),
            ...(maxBackupDays !== undefined ? { maxBackupDays } : {}),
            ...(stopOnBackup !== undefined ? { stopOnBackup } : {}),
        });

        const fresh = await getBackupSettings(serverId);
        res.json(fresh);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BACKUPS:SETTINGS_WRITE',
            fallbackMessage: 'Failed to update backup settings',
            logContext: { serverId: req.params.id },
        });
    }
});

// DELETE /api/servers/:id/backups/file
router.delete('/file', requireServerPermission(PERMISSIONS.backups.delete), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = requirePositiveInt(req.params.id, 'Invalid server id');

        const apiPath = optionalQueryString(req.query.path) ?? '';
        if (!apiPath) return res.status(400).json({ error: 'Missing path' });

        const server = await getServerOrThrow(serverId);
        const kind = getBackupKind(server);
        const location = await getBackupFileLocation(server);

        if (kind === 'directory') {
            const backupName = normalizeBackupFilename(apiPath.replace(/^\/+/, ''));
            if (!backupName) return res.status(400).json({ error: 'Invalid backup name' });
            assertSupportedBackupDirectory(server, backupName);
            const resolved = await resolveServerPath({
                serverId,
                path: joinApiPath(location.basePath, backupName),
                root: location.root,
            });
            await ensureIsDir(resolved.absPath, resolved.rootDir);
            await fs.rm(resolved.absPath, { recursive: true, force: true });
            return res.json({ success: true });
        }

        if (kind === 'file-pair') {
            const backupName = normalizeBackupFilename(apiPath.replace(/^\/+/, ''));
            if (!backupName) return res.status(400).json({ error: 'Invalid backup name' });

            const members = await resolveFilePairMembers({
                serverId,
                location,
                members: getBackupFilePair(server).membersOf(backupName),
            });
            if (members.length === 0) return res.status(404).json({ error: 'Backup not found' });

            for (const member of members) {
                await fs.unlink(member.absPath);
            }
            return res.json({ success: true });
        }

        const resolved = await resolveServerPath({
            serverId,
            path: joinApiPath(location.basePath, apiPath),
            root: location.root,
        });
        await ensureIsFile(resolved.absPath, resolved.rootDir);

        const filename = getBasenameFromApiPath(resolved.apiPath);
        assertSupportedBackupArchive(server, filename);

        await fs.unlink(resolved.absPath);

        return res.json({ success: true });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:BACKUPS:DELETE',
            fallbackMessage: 'Failed to delete backup',
            logContext: { serverId: req.params.id },
        });
    }
});

export default router;
