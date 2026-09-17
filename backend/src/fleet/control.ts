import express, { type Response, type NextFunction } from 'express';
import http from 'node:http';
import https from 'node:https';
import { getDatabase } from '../database/init.js';
import {
    serverRepository,
    serverMemberRepository,
    userRepository,
} from '../database/index.js';
import {
    authMiddleware,
    rootOnly,
    type AuthenticatedRequest,
} from '../middleware/auth.js';
import type { JWTPayload } from '../utils/auth.js';
import { nodes } from '../nodes/control.js';
import { nodeTls } from '../nodes/transport.js';
import { signNodeRequest, NODE_ID } from '../nodes/protocol.js';
import { delegatedPath, type Delegation } from '../nodes/delegation.js';
import { ASSIGNABLE_SERVER_PERMISSIONS } from '../permissions.js';
import { FleetStore, type InventoryItem, type FleetRow } from './store.js';

let store: FleetStore;
let refreshing: Promise<void> | undefined;
const reachable = new Map<string, number>();
export const fleet = () => store;
export async function initializeFleet() {
    store = new FleetStore(await getDatabase());
    await store.initialize();
    void refreshFleet().catch(() => {});
    const timer = setInterval(() => void refreshFleet().catch(() => {}), 30000);
    timer.unref();
}

async function readInventory(id: string): Promise<InventoryItem[]> {
    const node = await nodes().get(id);
    if (!node?.enabled || !node.key_encrypted)
        throw new Error('Node unavailable');
    const url = new URL('/api/servers', node.origin);
    return new Promise((resolve, reject) => {
        const req = (url.protocol === 'https:' ? https : http).request(
            url,
            {
                ...nodeTls(),
                headers: {
                    'x-gamepanel-node-auth': signNodeRequest(
                        nodes().key(node),
                        id,
                        'GET',
                        '/api/servers',
                        'fleet-inventory',
                    ),
                },
            },
            (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error('Inventory unavailable'));
                    return;
                }
                const chunks: Buffer[] = [];
                let bytes = 0;
                res.on('data', (chunk: Buffer) => {
                    bytes += chunk.length;
                    if (bytes > 16 * 1024 * 1024)
                        req.destroy(new Error('Inventory too large'));
                    else chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () => {
                    try {
                        const value = JSON.parse(
                            Buffer.concat(chunks).toString(),
                        );
                        if (!Array.isArray(value.servers))
                            throw new Error('Invalid inventory');
                        // Secrets, environment and host paths are never retained in the fleet database.
                        resolve(
                            value.servers.map((s: InventoryItem) => ({
                                id: s.id,
                                runtimeKey: s.runtimeKey,
                                name: s.name,
                                provider: s.provider,
                                status: s.status,
                            })),
                        );
                    } catch (e) {
                        reject(e);
                    }
                });
            },
        );
        const deadline = setTimeout(
            () => req.destroy(new Error('Inventory timeout')),
            10000,
        );
        req.once('close', () => clearTimeout(deadline));
        req.on('error', reject);
        req.end();
    });
}
export function refreshFleet(): Promise<void> {
    refreshing ??= (async () => {
        const local = await serverRepository.listAll();
        await store.observe(
            'local',
            local.map((s) => ({
                id: s.id,
                runtimeKey: s.runtime_uuid!,
                name: s.name,
                provider: s.provider,
                status: s.status,
            })),
        );
        reachable.set('local', Date.now());
        // Bounded concurrency; one slow/offline node does not prevent the other inventories from advancing.
        const remaining = (await nodes().list()).filter((n) => n.enabled);
        await Promise.all(
            Array.from({ length: Math.min(4, remaining.length) }, async () => {
                for (
                    let node = remaining.shift();
                    node;
                    node = remaining.shift()
                ) {
                    try {
                        await store.observe(
                            node.id,
                            await readInventory(node.id),
                        );
                        reachable.set(node.id, Date.now());
                    } catch {
                        reachable.delete(node.id);
                    }
                }
            }),
        );
    })().finally(() => {
        refreshing = undefined;
    });
    return refreshing;
}

export async function fleetPermissions(
    row: FleetRow,
    user: Pick<JWTPayload, 'userId' | 'isRoot'>,
): Promise<string[] | null> {
    if (
        row.node_id === 'local' &&
        (await serverRepository.findById(row.runtime_id))?.runtime_uuid !==
            row.runtime_key
    )
        return null;
    if (user.isRoot) return [...ASSIGNABLE_SERVER_PERMISSIONS];
    if (row.node_id !== 'local') return store.permissions(row.id, user.userId);
    const member = await serverMemberRepository.find(
        row.runtime_id,
        user.userId,
    );
    if (!member) return null;
    const permissions = await serverMemberRepository.getUserServerPermissions(
        row.runtime_id,
        user.userId,
    );
    return permissions.includes('*')
        ? [...ASSIGNABLE_SERVER_PERMISSIONS]
        : permissions;
}
export async function serverDelegation(
    id: string,
    nodeId: string,
    user: Pick<JWTPayload, 'userId' | 'isRoot'>,
): Promise<Delegation> {
    if (!NODE_ID.test(id)) throw new Error('Server unavailable');
    const row = await store.get(id);
    if (!row || row.missing || row.node_id !== nodeId)
        throw new Error('Server unavailable');
    const permissions = await fleetPermissions(row, user);
    if (permissions === null) throw new Error('Server unavailable');
    return {
        actorId: user.userId,
        serverId: row.runtime_id,
        runtimeKey: row.runtime_key,
        permissions,
    };
}
const safe =
    (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        void fn(req, res).catch(next);
    };

export function localFleetGuard(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
) {
    // The Local runtime uses the same stable identity check as an agent. A stale browser
    // context must not act on another instance that happens to reuse its numeric ID.
    const selected = req.headers['x-gamepanel-server'];
    if (!selected) {
        next();
        return;
    }
    void (async () => {
        const scope = await serverDelegation(
            String(selected),
            'local',
            req.user!,
        );
        const path = '/api/servers' + req.url;
        const members =
            req.user!.isRoot &&
            new RegExp(`^/${scope.serverId}/members(?:/|$)`).test(req.path);
        if (!delegatedPath(path, scope, req.method) && !members)
            throw new Error('Wrong server context');
        req.user!.runtimeScope = scope.serverId;
        next();
    })().catch(() =>
        res
            .status(403)
            .json({
                error: 'Server context unavailable; reopen the server from Game Servers',
            }),
    );
}

export function mountFleet(app: express.Application) {
    const router = express.Router();
    router.use(express.json({ limit: '16kb' }), authMiddleware);
    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    router.get(
        '/',
        safe(async (req, res) => {
            const rows = await store.list();
            const nodeList = await nodes().list();
            const servers = [];
            for (const row of rows) {
                if (row.missing) continue;
                const permissions = await fleetPermissions(row, req.user!);
                if (permissions === null) continue;
                const node = nodeList.find((n) => n.id === row.node_id);
                const available =
                    (row.node_id === 'local' || Boolean(node?.enabled)) &&
                    Date.now() - (reachable.get(row.node_id) || 0) < 75000;
                servers.push({
                    id: row.id,
                    name: row.name,
                    provider: row.provider,
                    node: {
                        name: node?.name || 'Local',
                        location: node?.location || 'Panel host',
                    },
                    status: available ? row.status : 'unknown',
                    available,
                    observedAt: row.observed_at,
                    placementRevision: row.placement_revision,
                });
            }
            res.json({ servers });
        }),
    );
    router.get(
        '/:id/context',
        safe(async (req, res) => {
            const row = await store.get(req.params.id);
            const permissions =
                row && !row.missing
                    ? await fleetPermissions(row, req.user!)
                    : null;
            if (!row || permissions === null)
                return res.status(404).json({ error: 'Server not found' });
            const node =
                row.node_id === 'local' ? null : await nodes().get(row.node_id);
            if (
                row.node_id !== 'local' &&
                (!node?.enabled || !node.key_encrypted)
            )
                return res.status(503).json({ error: 'Node unavailable' });
            res.json({
                id: row.id,
                runtimeId: row.runtime_id,
                nodeId: row.node_id,
                name: row.name,
                location: node?.location || 'Panel host',
                nodeName: node?.name || 'Local',
                permissions,
                placementRevision: row.placement_revision,
            });
        }),
    );
    router.use(rootOnly);
    router.post(
        '/refresh',
        safe(async (_req, res) => {
            await refreshFleet();
            res.json({ ok: true });
        }),
    );
    router.get(
        '/:id/members',
        safe(async (req, res) => {
            const row = await store.get(req.params.id);
            if (
                !row ||
                row.missing ||
                (await fleetPermissions(row, req.user!)) === null
            )
                return res.status(404).json({ error: 'Server not found' });
            const members =
                row.node_id === 'local'
                    ? await serverMemberRepository.listByServer(row.runtime_id)
                    : await store.grants(row.id);
            res.json({
                members: members.map((m) => ({
                    userId: m.user_id,
                    username: m.username,
                    permissions: JSON.parse(m.permissions_json),
                })),
                permissions: [...ASSIGNABLE_SERVER_PERMISSIONS],
            });
        }),
    );
    router.put(
        '/:id/members/:userId',
        safe(async (req, res) => {
            const row = await store.get(req.params.id);
            const userId = Number(req.params.userId);
            if (
                !row ||
                row.missing ||
                (await fleetPermissions(row, req.user!)) === null ||
                !Number.isSafeInteger(userId) ||
                !(await userRepository.findById(userId))
            )
                return res
                    .status(404)
                    .json({ error: 'Server or user not found' });
            const permissions = req.body?.permissions;
            if (
                !Array.isArray(permissions) ||
                permissions.length > ASSIGNABLE_SERVER_PERMISSIONS.size ||
                !permissions.every((p) => ASSIGNABLE_SERVER_PERMISSIONS.has(p))
            )
                return res
                    .status(400)
                    .json({ error: 'Invalid server permissions' });
            if (row.node_id === 'local') {
                if (await serverMemberRepository.find(row.runtime_id, userId))
                    await serverMemberRepository.update(
                        row.runtime_id,
                        userId,
                        permissions,
                    );
                else
                    await serverMemberRepository.create(
                        row.runtime_id,
                        userId,
                        permissions,
                    );
                await store.audit(
                    row.id,
                    req.user!.userId,
                    `grant:${userId}:${JSON.stringify(permissions)}`,
                );
            } else
                await store.grant(
                    row.id,
                    userId,
                    permissions,
                    req.user!.userId,
                );
            res.json({ ok: true });
        }),
    );
    router.delete(
        '/:id/members/:userId',
        safe(async (req, res) => {
            const row = await store.get(req.params.id);
            const userId = Number(req.params.userId);
            if (
                !row ||
                row.missing ||
                (await fleetPermissions(row, req.user!)) === null ||
                !Number.isSafeInteger(userId) ||
                userId <= 0
            )
                return res.status(404).json({ error: 'Server not found' });
            if (row.node_id === 'local') {
                await serverMemberRepository.delete(row.runtime_id, userId);
                await store.audit(row.id, req.user!.userId, `revoke:${userId}`);
            } else await store.revoke(row.id, userId, req.user!.userId);
            res.json({ ok: true });
        }),
    );
    app.use('/api/fleet', router);
}
