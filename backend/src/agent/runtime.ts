import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { agentIdentity } from './identity.js';
import { RequestVerifier, runtimePath, signNodeRequest, digest } from '../nodes/protocol.js';
import { nodeTls } from '../nodes/transport.js';
import { generateToken, verifyToken, extractTokenFromHeader } from '../utils/auth.js';
import { delegatedPath } from '../nodes/delegation.js';
import { getDatabase } from '../database/init.js';
import { getAppVersion } from '../utils/appInfo.js';
import { OperationJournal } from './journal.js';
import { serverRepository } from '../database/index.js';

const verifier = new RequestVerifier();
let principal: { id: number; token_version: number } | undefined;
let journal: OperationJournal;
export async function initializeAgent() {
    agentIdentity();
    const db = await getDatabase();
    principal = await db.get('SELECT id,token_version FROM users WHERE is_root=1 AND is_enabled=1');
    if (!principal) throw new Error('Agent runtime principal missing');
    await db.exec(
        'CREATE TABLE IF NOT EXISTS agent_identity (id INTEGER PRIMARY KEY CHECK(id=1), node_id TEXT NOT NULL)',
    );
    const existing = await db.get('SELECT node_id FROM agent_identity WHERE id=1');
    if (existing && existing.node_id !== agentIdentity().nodeId)
        throw new Error('Data directory belongs to another node');
    if (!existing) {
        const servers = await db.get('SELECT COUNT(*) AS count FROM game_servers');
        if (servers.count)
            throw new Error(
                'Agent enrollment requires a fresh runtime database; existing servers are not adopted',
            );
        await db.run('INSERT INTO agent_identity(id,node_id) VALUES(1,?)', agentIdentity().nodeId);
    }
    journal = new OperationJournal(db);
    await journal.initialize();
}

export function authorizeAgent(req: IncomingMessage): boolean {
    try {
        const identity = agentIdentity();
        const claim = verifier.verify(
            String(req.headers['x-gamepanel-node-auth'] || ''),
            identity.key,
            identity.nodeId,
            req.method || 'GET',
            req.url || '/',
        );
        if (!principal) return false;
        if (
            claim.delegation &&
            req.url !== '/api' &&
            !delegatedPath(req.url || '', claim.delegation, req.method || 'GET')
        )
            return false;
        // Local JWT is never returned to clients. Every inbound request needs a new bound signature.
        req.headers.authorization =
            'Bearer ' +
            generateToken({
                userId: claim.delegation?.actorId ?? principal.id,
                username: claim.actor,
                isRoot: !claim.delegation,
                tokenVersion: principal.token_version,
                delegation: claim.delegation,
            });
        delete req.headers.cookie;
        return true;
    } catch {
        return false;
    }
}
export function agentGate(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/api/health') {
        res.json({ status: 'healthy', role: 'agent', protocol: 1 });
        return;
    }
    if (!runtimePath(req.url) || /\/members(?:\/|\?|$)/.test(req.url)) {
        res.status(404).json({ error: 'Agent route unavailable' });
        return;
    }
    if (!authorizeAgent(req)) {
        res.status(401).json({ error: 'Agent authentication required' });
        return;
    }
    const delegation = verifyToken(extractTokenFromHeader(req.headers.authorization)!).delegation;
    if (!delegation) {
        next();
        return;
    }
    void serverRepository
        .findById(delegation.serverId)
        .then((server) => {
            if (!server || server.runtime_uuid !== delegation.runtimeKey)
                res.status(403).json({ error: 'Server identity changed' });
            else next();
        })
        .catch(next);
}

// Durable at-most-once admission for JSON mutations. Unknown outcome is never replayed.
export async function agentIdempotency(req: Request, res: Response, next: NextFunction) {
    if (req.method === 'GET' && req.path.startsWith('/api/operations/')) {
        const operation = await journal.lookup(req.path.slice('/api/operations/'.length));
        res.status(operation ? 200 : 404).json(operation || { error: 'Unknown operation' });
        return;
    }
    if (
        !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
        (req.headers['content-type'] && !req.is('application/json')) ||
        req.path.endsWith('/download-token')
    ) {
        next();
        return;
    }
    const key = String(req.headers['idempotency-key'] || '');
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
        res.status(400).json({
            error: 'A stable Idempotency-Key (16–128 characters) is required',
        });
        return;
    }
    const fingerprint = digest(
        JSON.stringify([
            req.method,
            req.originalUrl,
            req.body ?? null,
            verifyToken(extractTokenFromHeader(req.headers.authorization)!).delegation ?? null,
        ]),
    );
    try {
        const previous = await journal.admit(key, fingerprint);
        if (previous) {
            if (previous.fingerprint !== fingerprint) {
                res.status(409).json({
                    error: 'Idempotency key used for a different request',
                });
                return;
            }
            if (previous.state !== 'completed') {
                res.status(409).json({
                    error: 'Operation is running or its outcome is uncertain. Inspect node state before issuing a new operation.',
                    state: previous.state,
                });
                return;
            }
            res.setHeader('Idempotency-Replayed', 'true');
            res.status(previous.status).json(JSON.parse(previous.response));
            return;
        }
        const original = res.json.bind(res);
        let saving = false;
        res.json = ((body: unknown) => {
            if (saving) return res;
            saving = true;
            let encoded: string;
            try {
                encoded = JSON.stringify(body);
            } catch {
                void journal.uncertain(key).catch(() => {});
                res.status(503);
                original({
                    error: 'Result serialization failed; inspect operation outcome',
                });
                return res;
            }
            if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) {
                void journal
                    .uncertain(key)
                    .catch(() => {})
                    .then(() => original(body));
            } else {
                void journal
                    .complete(key, res.statusCode, encoded)
                    .then(() => original(body))
                    .catch(() => {
                        res.status(503);
                        original({
                            error: 'Result persistence failed; verify operation outcome before retrying',
                        });
                    });
            }
            return res;
        }) as Response['json'];
        res.once('close', () => {
            if (!saving) void journal.uncertain(key).catch(() => {});
        });
        next();
    } catch {
        res.status(503).json({
            error: 'Operation journal unavailable; request not executed',
        });
    }
}

export function startAgentHeartbeat() {
    const identity = agentIdentity();
    let busy = false;
    const tick = () => {
        if (busy) return;
        busy = true;
        const path = `/api/nodes/${identity.nodeId}/heartbeat`;
        const url = new URL(path, identity.panel);
        const data = JSON.stringify({ version: getAppVersion() });
        const req = (url.protocol === 'https:' ? https : http).request(
            url,
            {
                method: 'POST',
                ...nodeTls(),
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'x-gamepanel-node-auth': signNodeRequest(
                        identity.key,
                        identity.nodeId,
                        'POST',
                        path,
                        'agent',
                    ),
                },
            },
            (res) => {
                res.resume();
                // Authentication failures do not stop games; they only sever central management.
                if (res.statusCode !== 200)
                    console.warn(
                        'Agent heartbeat rejected; check enrollment and panel availability',
                    );
            },
        );
        const deadline = setTimeout(() => req.destroy(), 10000);
        req.once('close', () => {
            clearTimeout(deadline);
            busy = false;
        });
        req.once('error', () => {});
        req.end(data);
    };
    tick();
    const timer = setInterval(tick, 15000);
    return {
        stop() {
            clearInterval(timer);
        },
    };
}
