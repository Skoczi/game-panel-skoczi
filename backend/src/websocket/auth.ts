import type { IncomingMessage } from 'http';
import WebSocket from 'ws';

import { extractTokenFromHeader, verifyToken } from '../utils/auth.js';
import type { AuthenticatedWebSocket, OutgoingWebSocketMessage, WSMessage } from './types.js';

export function authenticateFromRequest(ws: AuthenticatedWebSocket, req: IncomingMessage): boolean {
    const tokenFromHeader = extractTokenFromHeader(req.headers.authorization);
    const token = tokenFromHeader;

    // Allow unauthenticated connections (client can authenticate later via WS message)
    if (!token) return true;

    try {
        const user = verifyToken(token);
        ws.userId = user.userId;
        ws.isRoot = Boolean(user.isRoot);
        ws.tokenVersion = user.tokenVersion;
        ws.delegation = user.delegation;
        return true;
    } catch {
        ws.close(1008, 'Invalid token');
        return false;
    }
}

export function authenticateFromMessage(ws: AuthenticatedWebSocket, message: WSMessage): boolean {
    if (message.type !== 'auth' || typeof message.token !== 'string') {
        sendSafe(ws, { type: 'error', error: 'Unauthorized' });
        return false;
    }

    try {
        const user = verifyToken(message.token);
        ws.userId = user.userId;
        ws.isRoot = Boolean(user.isRoot);
        ws.tokenVersion = user.tokenVersion;
        ws.delegation = user.delegation;
        return true;
    } catch {
        sendSafe(ws, { type: 'error', error: 'Invalid token' });
        ws.close(1008, 'Invalid token');
        return false;
    }
}

export function sendSafe(ws: WebSocket, payload: OutgoingWebSocketMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const client = ws as AuthenticatedWebSocket;
    if (!client.isRoot || client.runtimeScope !== undefined) {
        if (['error', 'auth:success', 'pong', 'terminal:error'].includes(payload.type)) {
            // Authentication/control messages contain no runtime data.
        } else {
            if (!client.accountValidatedAt || Date.now() - client.accountValidatedAt > 6000) return;
            const canSee = (id: number) => client.visibleServers?.has(id) === true;
            if (payload.type.startsWith('system')) return;
            if (
                'serverId' in payload &&
                payload.serverId !== undefined &&
                !canSee(payload.serverId)
            )
                return;
            const redact = <T extends { id: number; env?: unknown }>(s: T): T => {
                const perms = client.permissionsByServer?.[s.id] || [];
                return perms.includes('*') || perms.includes('server.env') ? s : { ...s, env: {} };
            };
            if (payload.type === 'servers:snapshot')
                payload = {
                    ...payload,
                    servers: payload.servers.filter((s) => canSee(s.id)).map(redact),
                };
            if (payload.type === 'servers:created' || payload.type === 'servers:updated') {
                if (!canSee(payload.server.id)) return;
                payload = { ...payload, server: redact(payload.server) };
            }
            if (payload.type === 'servers-metrics:update')
                payload = {
                    ...payload,
                    metrics: payload.metrics.filter((m) => canSee(m.serverId)),
                };
        }
    }

    try {
        ws.send(JSON.stringify(payload));
    } catch {
        // Ignore send errors when the client disconnects mid-flight.
    }
}
