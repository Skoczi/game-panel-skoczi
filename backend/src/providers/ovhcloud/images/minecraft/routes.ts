import { Router, type Response } from 'express';
import { actionsRepository, serverRepository } from '../../../../database/index.js';
import { type AuthenticatedRequest, requireServerPermission } from '../../../../middleware/auth.js';
import type { GameServerRow } from '../../../../types/gameServer.js';
import {
    boundedInt,
    optionalQueryString,
    optionalString,
    requireBodyObject,
    requirePositiveInt,
    requireTrimmedString,
} from '../../../../utils/httpValidation.js';
import { sendRouteError } from '../../../../utils/routeErrors.js';
import type { GameConsoleCommandResult } from '../../../../services/gameConsole.js';
import { PERMISSIONS } from '../../../../permissions.js';
import { createScopedFileAreaRouter } from '../../../../routes/scopedFileArea.js';
import { getOvhcloudMinecraftMetadata } from '../../../serverMetadata.js';
import {
    getMinecraftAddonProject,
    searchMinecraftAddons,
} from './addonsCatalog.js';
import {
    annotateSearchHitsWithInstalledState,
    installMinecraftAddon,
    listInstalledMinecraftAddons,
    setMinecraftAddonEnabled,
} from './addonsInstalled.js';
import {
    listMinecraftIpBans,

    listMinecraftOperators,
    listMinecraftPlayerBans,
    listMinecraftWhitelist,

    runMinecraftIpBanCommand,
    runMinecraftIpPardonCommand,
    runMinecraftOperatorCommand,
    runMinecraftPlayerBanCommand,
    runMinecraftPlayerPardonCommand,
    runMinecraftWhitelistEnabledCommand,
    runMinecraftWhitelistPlayerCommand,
} from './javaFeatures.js';

const router = Router({ mergeParams: true });

type GameServerWithContainer = GameServerRow & {
    docker_container_id: string;
};

async function getServerOrThrow(serverId: number): Promise<GameServerWithContainer> {
    const server = await serverRepository.findById(serverId);

    if (!server) {
        throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    }

    if (!server.docker_container_id) {
        throw Object.assign(new Error('Server has no container'), { statusCode: 400 });
    }

    return server as GameServerWithContainer;
}

function routeServerId(req: AuthenticatedRequest): number {
    return requirePositiveInt(req.params.id, 'Invalid server id');
}

async function logCommandResult(params: {
    serverId: number;
    actor: string;
    action: string;
    result: GameConsoleCommandResult;
}): Promise<void> {
    await actionsRepository.create(
        params.serverId,
        params.result.ok ? 'success' : 'error',
        params.result.ok
            ? params.action
            : `${params.action} failed (exitCode=${params.result.exitCode})`,
        params.actor
    );
}

function routeActor(req: AuthenticatedRequest): string {
    return req.user?.username || '';
}

// /api/servers/:id/minecraft/addons
router.use('/addons', createScopedFileAreaRouter({
    permissions: {
        read: PERMISSIONS.minecraft.addons.read,
        write: PERMISSIONS.minecraft.addons.write,
    },
    routeName: 'ROUTE:MINECRAFT:ADDONS',
    resolveArea(server) {
        const metadata = getOvhcloudMinecraftMetadata(server);

        if (metadata.edition !== 'java') {
            throw Object.assign(new Error('Addons are only available for OVHcloud Minecraft Java servers'), { statusCode: 501 });
        }

        if (metadata.serverType === 'paper') {
            return {
                root: 'data',
                basePath: '/plugins',
                kind: 'plugins',
            };
        }

        if (metadata.serverType === 'fabric' || metadata.serverType === 'neoforge' || metadata.serverType === 'forge') {
            return {
                root: 'data',
                basePath: '/mods',
                kind: 'mods',
            };
        }

        throw Object.assign(new Error('Addons are not supported for this Minecraft image'), { statusCode: 501 });
    },
}));

// GET /api/servers/:id/minecraft/addons-catalog/search
router.get('/addons-catalog/search', requireServerPermission(PERMISSIONS.minecraft.addons.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const result = await searchMinecraftAddons(server, {
            query: optionalQueryString(req.query.query),
            sort: optionalQueryString(req.query.sort),
            category: optionalQueryString(req.query.category),
            offset: boundedInt(req.query.offset, 0, 0, 5_000),
            limit: boundedInt(req.query.limit, 20, 1, 50),
            anyVersion: optionalQueryString(req.query.anyVersion) === 'true',
        });
        return res.json(await annotateSearchHitsWithInstalledState(server, result));
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:ADDONS_CATALOG_SEARCH',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to search the Minecraft addon catalog',
        });
    }
});

// GET /api/servers/:id/minecraft/addons-catalog/installed
router.get('/addons-catalog/installed', requireServerPermission(PERMISSIONS.minecraft.addons.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const result = await listInstalledMinecraftAddons(server);
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:ADDONS_CATALOG_INSTALLED',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to list the installed Minecraft addons',
        });
    }
});

// PUT /api/servers/:id/minecraft/addons-catalog/installed/:projectId
router.put('/addons-catalog/installed/:projectId', requireServerPermission(PERMISSIONS.minecraft.addons.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = req.body === undefined || req.body === null ? {} : requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);

        const result = await installMinecraftAddon(server, String(req.params.projectId), {
            versionId: optionalString(body.versionId) ?? null,
        });

        await actionsRepository.create(
            serverId,
            'success',
            result.replacedVersionId
                ? `Minecraft addon updated: ${result.addon.title ?? result.addon.fileName} (${result.addon.versionNumber ?? result.addon.versionId})`
                : `Minecraft addon installed: ${result.addon.title ?? result.addon.fileName} (${result.addon.versionNumber ?? result.addon.versionId})`,
            routeActor(req)
        );

        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:ADDONS_CATALOG_INSTALL',
            logContext: { serverId: req.params.id, projectId: req.params.projectId },
            fallbackMessage: 'Failed to install the Minecraft addon',
        });
    }
});

// PATCH /api/servers/:id/minecraft/addons-catalog/installed
router.patch('/addons-catalog/installed', requireServerPermission(PERMISSIONS.minecraft.addons.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const fileName = requireTrimmedString(body.fileName, 'fileName is required');

        if (typeof body.enabled !== 'boolean') {
            throw Object.assign(new Error('enabled must be a boolean'), { statusCode: 400 });
        }

        const server = await getServerOrThrow(serverId);
        const addon = await setMinecraftAddonEnabled(server, fileName, body.enabled);

        await actionsRepository.create(
            serverId,
            'success',
            `Minecraft addon ${body.enabled ? 'enabled' : 'disabled'}: ${addon.title ?? addon.fileName}`,
            routeActor(req)
        );

        return res.json({ addon, restartRequired: true });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:ADDONS_CATALOG_TOGGLE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to change the Minecraft addon state',
        });
    }
});

// GET /api/servers/:id/minecraft/addons-catalog/projects/:projectId
router.get('/addons-catalog/projects/:projectId', requireServerPermission(PERMISSIONS.minecraft.addons.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const project = await getMinecraftAddonProject(server, String(req.params.projectId), {
            anyVersion: optionalQueryString(req.query.anyVersion) === 'true',
        });
        return res.json({ project });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:ADDONS_CATALOG_PROJECT',
            logContext: { serverId: req.params.id, projectId: req.params.projectId },
            fallbackMessage: 'Failed to read the Minecraft addon details',
        });
    }
});

// GET /api/servers/:id/minecraft/operators
router.get('/operators', requireServerPermission(PERMISSIONS.minecraft.operators.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const operators = await listMinecraftOperators(server);
        return res.json({ operators });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:OPERATORS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to read Minecraft operators',
        });
    }
});

// POST /api/servers/:id/minecraft/operators
router.post('/operators', requireServerPermission(PERMISSIONS.minecraft.operators.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftOperatorCommand(server, 'op', body.name);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft operator added', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:OPERATOR_ADD',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to add Minecraft operator',
        });
    }
});

// DELETE /api/servers/:id/minecraft/operators/:name
router.delete('/operators/:name', requireServerPermission(PERMISSIONS.minecraft.operators.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftOperatorCommand(server, 'deop', req.params.name);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft operator removed', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:OPERATOR_REMOVE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to remove Minecraft operator',
        });
    }
});

// GET /api/servers/:id/minecraft/whitelist
router.get('/whitelist', requireServerPermission(PERMISSIONS.minecraft.whitelist.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const whitelist = await listMinecraftWhitelist(server);
        return res.json({ whitelist });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:WHITELIST_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to read Minecraft whitelist',
        });
    }
});

// PATCH /api/servers/:id/minecraft/whitelist
router.patch('/whitelist', requireServerPermission(PERMISSIONS.minecraft.whitelist.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftWhitelistEnabledCommand(server, body.enabled);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft whitelist updated', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:WHITELIST_TOGGLE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to update Minecraft whitelist',
        });
    }
});

// POST /api/servers/:id/minecraft/whitelist/players
router.post('/whitelist/players', requireServerPermission(PERMISSIONS.minecraft.whitelist.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftWhitelistPlayerCommand(server, 'add', body.name);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft whitelist player added', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:WHITELIST_PLAYER_ADD',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to add Minecraft whitelist player',
        });
    }
});

// DELETE /api/servers/:id/minecraft/whitelist/players/:name
router.delete('/whitelist/players/:name', requireServerPermission(PERMISSIONS.minecraft.whitelist.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftWhitelistPlayerCommand(server, 'remove', req.params.name);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft whitelist player removed', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:WHITELIST_PLAYER_REMOVE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to remove Minecraft whitelist player',
        });
    }
});

// GET /api/servers/:id/minecraft/bans/players
router.get('/bans/players', requireServerPermission(PERMISSIONS.minecraft.bans.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const bans = await listMinecraftPlayerBans(server);
        return res.json({ bans });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:BANS_PLAYERS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to read Minecraft player bans',
        });
    }
});

// POST /api/servers/:id/minecraft/bans/players
router.post('/bans/players', requireServerPermission(PERMISSIONS.minecraft.bans.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftPlayerBanCommand(server, body.name, optionalString(body.reason));
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft player banned', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:BANS_PLAYER_ADD',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to ban Minecraft player',
        });
    }
});

// DELETE /api/servers/:id/minecraft/bans/players/:name
router.delete('/bans/players/:name', requireServerPermission(PERMISSIONS.minecraft.bans.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftPlayerPardonCommand(server, req.params.name);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft player unbanned', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:BANS_PLAYER_REMOVE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to unban Minecraft player',
        });
    }
});

// GET /api/servers/:id/minecraft/bans/ips
router.get('/bans/ips', requireServerPermission(PERMISSIONS.minecraft.ipBans.read), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const bans = await listMinecraftIpBans(server);
        return res.json({ bans });
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:BANS_IPS_READ',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to read Minecraft IP bans',
        });
    }
});

// POST /api/servers/:id/minecraft/bans/ips
router.post('/bans/ips', requireServerPermission(PERMISSIONS.minecraft.ipBans.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const body = requireBodyObject(req.body);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftIpBanCommand(server, body.target, optionalString(body.reason));
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft IP banned', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:BANS_IP_ADD',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to ban Minecraft IP',
        });
    }
});

// DELETE /api/servers/:id/minecraft/bans/ips/:ip
router.delete('/bans/ips/:ip', requireServerPermission(PERMISSIONS.minecraft.ipBans.write), async (req: AuthenticatedRequest, res: Response) => {
    try {
        const serverId = routeServerId(req);
        const server = await getServerOrThrow(serverId);
        const result = await runMinecraftIpPardonCommand(server, req.params.ip);
        await logCommandResult({ serverId, actor: routeActor(req), action: 'Minecraft IP unbanned', result });
        return res.json(result);
    } catch (error) {
        return sendRouteError(res, error, {
            route: 'ROUTE:MINECRAFT:BANS_IP_REMOVE',
            logContext: { serverId: req.params.id },
            fallbackMessage: 'Failed to unban Minecraft IP',
        });
    }
});

export default router;
