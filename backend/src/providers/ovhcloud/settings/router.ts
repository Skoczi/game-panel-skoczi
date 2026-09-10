import { Router, type Response } from 'express';
import { actionsRepository, serverRepository } from '../../../database/index.js';
import {
    type AuthenticatedRequest,
    requireServerPermission,
    userHasServerPermission,
} from '../../../middleware/auth.js';
import { PERMISSIONS } from '../../../permissions.js';
import { bus } from '../../../realtime/bus.js';
import { reconfigureServerContainer } from '../../../services/serverReconfiguration.js';
import type { GameServerRow } from '../../../types/gameServer.js';
import {
    requireBodyObject,
    requirePositiveInt,
    requireRecord,
    requireTrimmedString,
} from '../../../utils/httpValidation.js';
import { sendRouteError } from '../../../utils/routeErrors.js';
import { nowIso } from '../../../utils/time.js';
import { getOvhcloudServerAdapter } from '../adapters/registry.js';
import { listConfigFiles } from './configFiles.js';
import { listFileSettings, patchFileSettings, resolveFileSettingsPolicy } from './fileSettings.js';
import { collectSettingGroups } from './groups.js';
import {
    buildLaunchEnvPatch,
    envMapToArray,
    listLaunchSettings,
    resolveLaunchSettingOptions,
} from './launchSettings.js';
import type {
    LaunchSettingsPatchResult,
    OvhcloudSettingsSupport,
    Setting,
    SettingsPayload,
} from './types.js';

const router = Router({ mergeParams: true });

type ServerSettings = {
    server: GameServerRow;
    support: OvhcloudSettingsSupport;
};

function routeServerId(req: AuthenticatedRequest): number {
    return requirePositiveInt(req.params.id, 'Invalid server id');
}

function routeActor(req: AuthenticatedRequest): string {
    return req.user?.username || '';
}

function getSettingsPatch(body: unknown): Record<string, unknown> {
    return requireRecord(requireBodyObject(body).settings, 'settings must be an object');
}

async function getServerSettingsOrThrow(serverId: number): Promise<ServerSettings> {
    const server = await serverRepository.findById(serverId);
    if (!server) {
        throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    }

    const support = getOvhcloudServerAdapter(server).settings;
    if (!support) {
        throw Object.assign(new Error('This game has no managed settings'), { statusCode: 501 });
    }

    return { server, support };
}

function forbidden(): never {
    throw Object.assign(new Error('Insufficient server permissions'), { statusCode: 403 });
}

async function canReadFileSettings(req: AuthenticatedRequest, serverId: number, support: OvhcloudSettingsSupport) {
    return Boolean(support.file)
        && await userHasServerPermission(req.user, serverId, support.file!.permissions.read);
}

async function canReadLaunchSettings(req: AuthenticatedRequest, serverId: number, support: OvhcloudSettingsSupport) {
    return Boolean(support.launch) && await userHasServerPermission(req.user, serverId, PERMISSIONS.server.env);
}

async function assertCanWriteLaunchSettings(req: AuthenticatedRequest, serverId: number): Promise<void> {
    const [canEnv, canEdit] = await Promise.all([
        userHasServerPermission(req.user, serverId, PERMISSIONS.server.env),
        userHasServerPermission(req.user, serverId, PERMISSIONS.server.edit),
    ]);

    if (!canEnv || !canEdit) forbidden();
}

function usedGroups(settings: Setting[][]) {
    return collectSettingGroups(settings.flat().map((setting) => setting.group));
}

// GET /api/servers/:id/settings
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const { server, support } = await getServerSettingsOrThrow(serverId);

        const [readFile, readLaunch, readFiles] = await Promise.all([
            canReadFileSettings(req, serverId, support),
            canReadLaunchSettings(req, serverId, support),
            userHasServerPermission(req.user, serverId, PERMISSIONS.fs.read),
        ]);

        if (!readFile && !readLaunch && !readFiles) forbidden();

        const [fileSettings, fileSettingsPolicy, launchSettings, configFiles] = await Promise.all([
            readFile && support.file ? listFileSettings(server, support.file.accessor()) : Promise.resolve([]),
            support.file
                ? resolveFileSettingsPolicy(server, support.file.accessor())
                : Promise.resolve({ writableWhileRunning: true }),
            readLaunch && support.launch ? listLaunchSettings(server, support.launch()) : Promise.resolve([]),
            readFiles ? listConfigFiles(server, support) : Promise.resolve([]),
        ]);

        const payload: SettingsPayload = {
            groups: usedGroups([fileSettings, launchSettings]),
            fileSettings,
            fileSettingsPolicy,
            launchSettings,
            configFiles,
        };

        return res.json(payload);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:OVHCLOUD:SETTINGS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to read server settings',
        });
    }
});

// GET /api/servers/:id/settings/options?key=<key>&<dependsOn>=<value>
router.get('/options', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const { server, support } = await getServerSettingsOrThrow(serverId);

        if (!support.launch || !await canReadLaunchSettings(req, serverId, support)) forbidden();

        const key = requireTrimmedString(req.query.key, 'key is required');
        const params: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.query)) {
            if (name !== 'key' && typeof value === 'string') params[name] = value;
        }

        const options = await resolveLaunchSettingOptions(server, support.launch(), key, params);
        return res.json({ key, options });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:OVHCLOUD:SETTINGS_OPTIONS',
            logContext: { serverId: req.params.id, key: req.query.key },
            fallbackMessage: 'Failed to read setting options',
        });
    }
});

// PATCH /api/servers/:id/settings/file
router.patch('/file', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const { server, support } = await getServerSettingsOrThrow(serverId);

        if (!support.file) {
            throw Object.assign(new Error('This game has no file-backed settings'), { statusCode: 501 });
        }
        if (!await userHasServerPermission(req.user, serverId, support.file.permissions.write)) forbidden();

        const result = await patchFileSettings(server, support.file.accessor(), getSettingsPatch(req.body));

        await actionsRepository.create(
            serverId,
            'success',
            `${support.label} settings updated: ${result.updated.join(', ')}`,
            routeActor(req)
        );

        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:OVHCLOUD:SETTINGS_FILE_WRITE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to update server settings',
        });
    }
});

// PATCH /api/servers/:id/settings/launch
router.patch('/launch', requireServerPermission(PERMISSIONS.server.edit), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const { server, support } = await getServerSettingsOrThrow(serverId);

        if (!support.launch) {
            throw Object.assign(new Error('This game has no start parameters'), { statusCode: 501 });
        }
        await assertCanWriteLaunchSettings(req, serverId);

        const patch = await buildLaunchEnvPatch(server, support.launch(), getSettingsPatch(req.body));

        let recreated = false;
        let restarted = false;

        if (patch.changed) {
            const reconfigure = await reconfigureServerContainer(serverId, {
                env: envMapToArray(patch.nextEnv),
            });
            recreated = reconfigure.reconfigured;
            restarted = reconfigure.wasRunning;

            await actionsRepository.create(
                serverId,
                'success',
                `${support.label} start parameters updated: ${patch.updated.join(', ')}`,
                routeActor(req)
            );

            bus.emit('server.updated', { serverId, timestamp: nowIso() });
        }

        const updatedServer = await serverRepository.findById(serverId) ?? server;

        const result: LaunchSettingsPatchResult = {
            updated: patch.updated,
            recreated,
            restarted,
            settings: await listLaunchSettings(updatedServer, support.launch()),
        };

        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:OVHCLOUD:SETTINGS_LAUNCH_WRITE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to update server start parameters',
        });
    }
});

export default router;
