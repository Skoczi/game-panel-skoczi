import { alertStore } from '../services/alerts.js';
import { validateAlertBatch } from '../services/alertStore.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { getDatabase } from '../database/init.js';
import { getConfig } from '../config.js';
import { authMiddleware, rootOnly, type AuthenticatedRequest } from '../middleware/auth.js';
import { userRepository } from '../database/index.js';
import { verifyToken } from '../utils/auth.js';
import { NodeStore, NodeRemovalError } from './store.js';
import { NODE_ID, RequestVerifier, runtimePath, signNodeRequest, secret } from './protocol.js';
import { nodeTls, proxyRuntime } from './transport.js';
import { serverDelegation, verifyNodeEmpty } from '../fleet/control.js';
import { delegatedPath, type Delegation } from './delegation.js';
import { NodeAllocations, AllocationError } from './allocations.js';
import { allocationRuntime } from './allocationRuntime.js';
import { LocalProfileStore } from './localProfile.js';
import { getAppVersion } from '../utils/appInfo.js';

let store: NodeStore;
let allocations: NodeAllocations;
let localProfile: LocalProfileStore;
const verifier = new RequestVerifier();
const enrollmentAttempts = new Map<string, { until: number; count: number }>();
const downloads = new Map<
    string,
    {
        nodeId: string;
        path: string;
        actor: string;
        expires: number;
        credential: string;
        userToken: string;
        serverId?: string;
    }
>();
export async function initializeNodes() {
    store = new NodeStore(
        await getDatabase(),
        getConfig().jwtSecret,
        process.env.GAMEPANEL_TEST_LOOPBACK_NODES === '1',
    );
    await store.initialize();
    const db = await getDatabase();
    localProfile = new LocalProfileStore(db);
    await localProfile.initialize();
    allocations = new NodeAllocations(db, allocationRuntime(db, store));
    await allocations.initialize();
}
export const nodes = () => store;
const safe =
    (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
        void fn(req, res).catch(next);
    };

export function mountNodeControl(app: express.Application) {
    app.get(
        '/api/node-download/:token',
        safe(async (req, res) => {
            const claim = downloads.get(req.params.token);
            downloads.delete(req.params.token);
            if (!claim || claim.expires < Date.now())
                return res.status(404).json({ error: 'Download expired' });
            let delegatedDownload: Delegation | undefined;
            try {
                const user = await activeUser(claim.userToken);
                if (!user.is_root || claim.serverId) {
                    const delegation = await serverDelegation(claim.serverId || '', claim.nodeId, {
                        userId: user.id,
                        isRoot: Boolean(user.is_root),
                    });
                    if (!delegation.permissions.includes('fs.read')) throw new Error();
                    delegatedDownload = { ...delegation, downloadPath: claim.path };
                }
            } catch {
                return res.status(403).json({ error: 'Download access revoked' });
            }
            const node = await store.get(claim.nodeId);
            if (!node?.enabled || node.key_encrypted !== claim.credential)
                return res.status(503).json({ error: 'Node unavailable' });
            proxyRuntime(req, res, {
                origin: node.origin,
                nodeId: node.id,
                key: store.key(node),
                path: claim.path,
                actor: claim.actor,
                delegation: delegatedDownload,
            });
        }),
    );
    // Before global body parsers: upload/download bytes stay streams.
    app.use(
        '/api/nodes/:nodeId/runtime',
        authMiddleware,
        safe(async (req, res) => {
            if (!NODE_ID.test(req.params.nodeId) || !runtimePath(req.url))
                return res.status(404).json({ error: 'Unknown node runtime path' });
            const node = await store.get(req.params.nodeId);
            if (!node?.enabled || !node.key_encrypted)
                return res.status(503).json({ error: 'Node disabled or not enrolled' });
            if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.replace(/\/+$/, '') === '/api/system/settings')
                return res.status(409).json({ error: 'Manage IP allocations through Nodes → Node settings. Direct settings writes are disabled.' });
            let delegation: Delegation | undefined;
            if (!req.user!.isRoot || req.headers['x-gamepanel-server']) {
                try {
                    delegation = await serverDelegation(
                        String(req.headers['x-gamepanel-server'] || ''),
                        node.id,
                        req.user!,
                    );
                    if (!delegatedPath(req.url, delegation, req.method)) throw new Error();
                } catch {
                    return res.status(403).json({ error: 'Server access denied' });
                }
            }
            if (/\/members(?:\/|\?|$)/.test(req.url))
                return res.status(409).json({
                    error: 'Manage server members from the central Game Servers workspace.',
                });
            const transformJson =
                req.method === 'POST' && req.path.endsWith('/files/download-token')
                    ? (value: Record<string, unknown>) => {
                          if (
                              typeof value.path !== 'string' ||
                              !/^\/api\/download\/[a-zA-Z0-9_-]{43}$/.test(value.path)
                          )
                              throw new Error('Invalid download response');
                          for (const [id, item] of downloads)
                              if (item.expires < Date.now()) downloads.delete(id);
                          if (downloads.size >= 10000) throw new Error('Download capacity reached');
                          const token = secret();
                          downloads.set(token, {
                              nodeId: node.id,
                              path: value.path,
                              actor: req.user!.username,
                              expires: Date.now() + 60000,
                              credential: node.key_encrypted!,
                              userToken: req.headers.authorization!.split(' ')[1],
                              serverId: String(req.headers['x-gamepanel-server'] || ''),
                          });
                          return {
                              ...value,
                              token,
                              path: `/api/node-download/${token}`,
                          };
                      }
                    : undefined;
            proxyRuntime(req, res, {
                origin: node.origin,
                nodeId: node.id,
                key: store.key(node),
                path: req.url,
                actor: req.user!.username,
                delegation,
                transformJson,
            });
        }),
    );
    const router = express.Router();
    router.use(express.json({ limit: '512kb' }));
    // Enrollment errors deliberately reveal no token validity details.
    router.post('/:id/enroll', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const now = Date.now();
        for (const [address, bucket] of enrollmentAttempts)
            if (bucket.until <= now) enrollmentAttempts.delete(address);
        // Use the peer address rather than trusting caller-supplied forwarding headers.
        const peer = req.socket.remoteAddress || 'unknown';
        const bucket = enrollmentAttempts.get(peer) || {
            until: now + 60000,
            count: 0,
        };
        if (
            bucket.count >= 30 ||
            (!enrollmentAttempts.has(peer) && enrollmentAttempts.size >= 10000)
        ) {
            res.setHeader('Retry-After', '60');
            res.status(429).json({ error: 'Enrollment rate limit' });
            return;
        }
        bucket.count++;
        enrollmentAttempts.set(peer, bucket);
        try {
            if (!NODE_ID.test(req.params.id)) throw new Error();
            const result = await store.enroll(req.params.id, req.body?.token);
            res.setHeader('Cache-Control', 'no-store');
            res.json(result);
        } catch {
            res.status(401).json({ error: 'Enrollment rejected' });
        }
    });
    router.post('/:id/heartbeat', async (req, res) => {
        try {
            const node = await store.get(req.params.id);
            if (!node) throw new Error();
            verifier.verify(
                String(req.headers['x-gamepanel-node-auth'] || ''),
                store.key(node),
                node.id,
                'POST',
                req.originalUrl,
            );
            if (typeof req.body?.version !== 'string') throw new Error();
            await store.heartbeat(node.id, req.body.version);
            const alertAck = req.body.alerts === undefined ? [] : await (await alertStore()).receive(node.id, node.name, validateAlertBatch(req.body.alerts));
            res.json({ ok: true, protocol: 1, alertAck });
        } catch {
            res.status(401).json({ error: 'Heartbeat rejected' });
        }
    });
    router.use(authMiddleware, rootOnly);
    const allocationAction = (run: (req: AuthenticatedRequest) => Promise<unknown>) => safe(async (req, res) => {
        if (req.params.id !== 'local' && !NODE_ID.test(req.params.id)) return res.status(400).json({ error: 'Invalid node' });
        try { return res.json(await run(req)); }
        catch (error) {
            if (error instanceof AllocationError || (error as { statusCode?: number }).statusCode)
                return res.status((error as { statusCode?: number }).statusCode || 409).json({ error: (error as Error).message });
            return res.status(503).json({ error: 'Cannot read or confirm node allocations. Any outstanding IP reservations are retained.' });
        }
    });
    router.get('/:id/allocations', allocationAction(req => allocations.read(req.params.id)));
    router.put('/:id/allocations', allocationAction(req => {
        if (!req.body || Object.keys(req.body).some(key => !['network', 'revision'].includes(key)))
            throw new AllocationError('Expected network and revision only.', 400);
        return allocations.save(req.params.id, req.body.network, req.body.revision);
    }));
    router.post('/:id/allocations/retry', allocationAction(req => allocations.retry(req.params.id)));
    router.get(
        '/',
        safe(async (_req, res) =>
            res.json({
                nodes: await store.list(),
                local: { ...await localProfile.read(), id: 'local', status: 'online', agent_version: getAppVersion(), last_seen: Date.now(), heartbeat_kind: 'panel-response' },
            }),
        ),
    );
    // Display metadata only: origin is never used for local routing or authentication.
    router.put('/local/profile', safe(async (req, res) => {
        try { res.json({ local: await localProfile.save(req.body) }); }
        catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Cannot save local profile' }); }
    }));
    router.post(
        '/',
        safe(async (req, res) => {
            try {
                res.status(201).json(await store.create(req.body, req.user!.username));
            } catch {
                res.status(400).json({
                    error: 'Invalid or duplicate node. Use a unique HTTPS origin and a name up to 80 characters.',
                });
            }
        }),
    );
    router.patch(
        '/:id',
        safe(async (req, res) => {
            if (typeof req.body?.enabled !== 'boolean')
                return res.status(400).json({ error: 'enabled must be boolean' });
            await store.setEnabled(req.params.id, req.body.enabled, req.user!.username);
            return res.json({ ok: true });
        }),
    );
    router.delete(
        '/:id',
        safe(async (req, res) => {
            try {
                await allocations.removeNode(req.params.id, () => store.remove(req.params.id, req.body?.confirmationName, req.user!.username, verifyNodeEmpty));
                return res.json({ ok: true });
            } catch (error) {
                if (error instanceof NodeRemovalError)
                    return res.status(error.status).json({ error: error.message });
                if (error instanceof AllocationError)
                    return res.status(error.statusCode).json({ error: error.message });
                throw error;
            }
        }),
    );
    router.post(
        '/:id/credentials',
        safe(async (req, res) =>
            res.json(await store.renewEnrollment(req.params.id, req.user!.username)),
        ),
    );
    router.get(
        '/:id/audit',
        safe(async (req, res) =>
            res.json({
                events: await (
                    await getDatabase()
                ).all(
                    'SELECT actor,action,created_at FROM node_audit WHERE node_id=? ORDER BY id DESC LIMIT 100',
                    req.params.id,
                ),
            }),
        ),
    );
    app.use('/api/nodes', router);
}

async function activeUser(token: string) {
    const payload = verifyToken(token);
    const user = await userRepository.findById(payload.userId);
    if (
        !user ||
        payload.delegation ||
        !user.is_enabled ||
        user.token_version !== payload.tokenVersion
    )
        throw new Error('Access denied');
    return user;
}

export function createNodeWebSocketRouter(
    server: Server,
    local: WebSocketServer,
    agentUpgrade?: (req: IncomingMessage) => boolean,
) {
    const remoteSockets = new WebSocketServer({
        noServer: true,
        maxPayload: 1024 * 1024,
    });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const match = /^\/api\/nodes\/([0-9a-f-]{36})\/ws(?:\?server=([0-9a-f-]{36}))?$/.exec(
            req.url || '',
        );
        if (match && !agentUpgrade) {
            remoteSockets.handleUpgrade(req, socket, head, (client) =>
                bridgeNodeSocket(client, match[1], match[2]),
            );
        } else if (
            (req.url === '/api' || req.url === '/' ||
                (!agentUpgrade && /^\/api\?server=[0-9a-f-]{36}$/.test(req.url || ''))) &&
            (!agentUpgrade || agentUpgrade(req))
        ) {
            local.handleUpgrade(req, socket, head, (ws) => local.emit('connection', ws, req));
        } else socket.destroy();
    });
    return () => {
        for (const socket of remoteSockets.clients) socket.terminate();
        remoteSockets.close();
    };
}

function bridgeNodeSocket(client: WebSocket, nodeId: string, serverId?: string) {
    let upstream: WebSocket | undefined;
    let token = '';
    let starting = false;
    let ready = false;
    let validating = false;
    let credential = '';
    let accessFingerprint = '';
    const access = async () => {
        const user = await activeUser(token);
        const delegation = user.is_root && !serverId
            ? undefined
            : await serverDelegation(serverId || '', nodeId, {
                  userId: user.id,
                  isRoot: Boolean(user.is_root),
              });
        return {
            user,
            delegation,
            fingerprint: JSON.stringify([Boolean(user.is_root), delegation]),
        };
    };
    const authDeadline = setTimeout(() => client.close(1008, 'Authentication timeout'), 3000);
    const watchdog = setInterval(() => {
        if (!ready || validating) return;
        validating = true;
        void Promise.all([access(), store.get(nodeId)])
            .then(([current, node]) => {
                if (
                    !node?.enabled ||
                    node.key_encrypted !== credential ||
                    current.fingerprint !== accessFingerprint
                )
                    client.close(1008, 'Node access revoked');
            })
            .catch(() => client.close(1008, 'Access revoked'))
            .finally(() => {
                validating = false;
            });
    }, 5000);
    const cleanup = () => {
        clearTimeout(authDeadline);
        clearInterval(watchdog);
        upstream?.terminate();
    };
    client.on('close', cleanup);
    client.on('error', cleanup);
    client.on('message', (data: RawData, binary: boolean) => {
        if (binary) {
            client.close(1003, 'JSON frames only');
            return;
        }
        if (ready) {
            if (
                !upstream ||
                upstream.readyState !== WebSocket.OPEN ||
                upstream.bufferedAmount > 2 * 1024 * 1024
            ) {
                client.close(1013, 'Node backpressure');
                return;
            }
            try {
                if (JSON.parse(data.toString()).type === 'auth') return;
            } catch {
                client.close(1008, 'Invalid message');
                return;
            }
            upstream.send(data.toString());
            return;
        }
        if (starting) {
            client.close(1008, 'Authenticate before commands');
            return;
        }
        starting = true;
        void (async () => {
            const message = JSON.parse(data.toString());
            if (message.type !== 'auth' || typeof message.token !== 'string') throw new Error();
            token = message.token;
            const { user, delegation, fingerprint } = await access();
            accessFingerprint = fingerprint;
            const node = await store.get(nodeId);
            if (!node?.enabled || !node.key_encrypted) throw new Error();
            credential = node.key_encrypted;
            const url = new URL('/api', node.origin);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            upstream = new WebSocket(url, {
                ...nodeTls(),
                handshakeTimeout: 10000,
                maxPayload: 1024 * 1024,
                headers: {
                    'x-gamepanel-node-auth': signNodeRequest(
                        store.key(node),
                        node.id,
                        'GET',
                        '/api',
                        user.username,
                        delegation,
                    ),
                },
            });
            clearTimeout(authDeadline);
            upstream.on('open', () => {
                ready = true;
                upstream!.send(JSON.stringify({ type: 'auth' }));
            });
            upstream.on('message', (frame, isBinary) => {
                if (client.readyState !== WebSocket.OPEN) return;
                if (client.bufferedAmount > 2 * 1024 * 1024) {
                    client.close(1013, 'Client backpressure');
                    return;
                }
                client.send(frame, { binary: isBinary });
            });
            upstream.on('close', () => client.close(1012, 'Node disconnected'));
            upstream.on('error', () => client.close(1013, 'Node unavailable'));
            if (client.readyState !== WebSocket.OPEN) cleanup();
        })().catch(() => client.close(1008, 'Node access denied'));
    });
}
