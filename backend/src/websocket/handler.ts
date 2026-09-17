import type { IncomingMessage } from 'http';
import { WebSocketServer, type RawData } from 'ws';
import crypto from 'node:crypto';
import { handleTerminalWsMessage, cleanupTerminalWs } from './terminalWs.js';
import type { AuthenticatedWebSocket, WSMessage } from './types.js';
import { parseIncomingWebSocketMessage } from './incoming.js';
import { authenticateFromMessage, authenticateFromRequest, sendSafe } from './auth.js';
import { attachBroadcaster } from './broadcaster.js';
import {
  cleanupClient,
  ensureSubs,
  handleSubscribeInstall,
  handleSubscribeLogs,
  handleSubscribeActions,
  handleSubscribeServers,
  handleSubscribeServersMetrics,
  handleSubscribeSystemMetrics,
  handleUnsubscribe,
  handleSubscribeFileTransfers,
} from './subscriptions.js';
import { userRepository, serverMemberRepository, serverRepository } from '../database/index.js';
import { startSystemMetricsPoller } from './pollers/systemMetricsPoller.js';
import { startServerMetricsPoller } from './pollers/serverMetricsPoller.js';
import { logError } from '../utils/logger.js';
import { PERMISSIONS } from '../permissions.js';
import { serverPermissions } from '../middleware/auth.js';
import { isAgent } from '../agent/identity.js';
import { serverDelegation } from '../fleet/control.js';

const WS_AUTH_TIMEOUT_MS = 3_000;
const WS_ACCOUNT_VALIDATION_TTL_MS = 5_000;

async function ensureWsUserEnabled(ws: AuthenticatedWebSocket): Promise<boolean> {
  if (!ws.userId) return false;

  const now = Date.now();
  if (
    typeof ws.accountValidatedAt === 'number' &&
    now - ws.accountValidatedAt < WS_ACCOUNT_VALIDATION_TTL_MS
  ) {
    return true;
  }

  if (ws.delegation) {
    if (!isAgent()) {
      ws.close(1008, 'Invalid credential');
      return false;
    }
    const server = await serverRepository.findById(ws.delegation.serverId);
    if (!server || server.runtime_uuid !== ws.delegation.runtimeKey) {
      ws.close(1008, 'Server identity changed');
      return false;
    }
    ws.isRoot = false;
    ws.visibleServers = new Set([ws.delegation.serverId]);
    ws.permissionsByServer = {
      [ws.delegation.serverId]: ws.delegation.permissions,
    };
    ws.accountValidatedAt = now;
    return true;
  }
  const user = await userRepository.findById(ws.userId);
  if (!user) {
    sendSafe(ws, { type: 'error', error: 'Unauthorized' });
    ws.close(1008, 'Unauthorized');
    return false;
  }

  if (!user.is_enabled) {
    sendSafe(ws, { type: 'error', error: 'Account disabled' });
    ws.close(1008, 'Account disabled');
    return false;
  }

  if (ws.tokenVersion !== user.token_version) {
    sendSafe(ws, { type: 'error', error: 'Unauthorized' });
    ws.close(1008, 'Unauthorized');
    return false;
  }

  ws.isRoot = Boolean(user.is_root);
  if (ws.selectedServer) {
    try {
      const scope = await serverDelegation(ws.selectedServer, 'local', {
        userId: ws.userId,
        isRoot: ws.isRoot,
      });
      const fingerprint = JSON.stringify([ws.isRoot, scope]);
      if (ws.accessFingerprint && ws.accessFingerprint !== fingerprint)
        throw new Error('Access changed');
      ws.accessFingerprint = fingerprint;
      ws.runtimeScope = scope.serverId;
      ws.visibleServers = new Set([scope.serverId]);
      ws.permissionsByServer = { [scope.serverId]: scope.permissions };
      ws.accountValidatedAt = now;
      return true;
    } catch {
      ws.close(1008, 'Server context changed; reopen server');
      return false;
    }
  }
  const memberships = await serverMemberRepository.listByUser(ws.userId);
  const fingerprint = JSON.stringify([
    ws.isRoot,
    memberships.map((m) => [m.server_id, m.permissions_json]),
  ]);
  if (ws.accessFingerprint && ws.accessFingerprint !== fingerprint) {
    ws.close(1008, 'Permissions changed; reconnect');
    return false;
  }
  ws.accessFingerprint = fingerprint;
  ws.visibleServers = new Set(memberships.map((m) => m.server_id));
  ws.permissionsByServer = Object.fromEntries(
    memberships.map((m) => [m.server_id, JSON.parse(m.permissions_json)]),
  );
  ws.accountValidatedAt = now;
  return true;
}

async function hasServerPermission(
  ws: AuthenticatedWebSocket,
  serverId: number,
  perm: string,
): Promise<boolean> {
  if (ws.isRoot) return true;
  if (!ws.userId) return false;

  const perms = await serverPermissions(ws, serverId);
  return perms.includes('*') || perms.includes(perm);
}

export function setupWebSocket(wss: WebSocketServer): void {
  const broadcaster = attachBroadcaster(wss);

  // Start global pollers once at boot
  const systemMetricsTimer = startSystemMetricsPoller(wss, {
    intervalMs: 10_000,
  });
  const serverMetricsTimer = startServerMetricsPoller(wss, {
    intervalMs: 10_000,
  });

  const heartbeatInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AuthenticatedWebSocket;

      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }

      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  const accessInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AuthenticatedWebSocket;
      if (ws.userId)
        void ensureWsUserEnabled(ws).catch(() => ws.close(1008, 'Authorization unavailable'));
    }
  }, 1000);

  wss.on('connection', (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    ws.isAlive = true;
    if (!isAgent())
      ws.selectedServer =
        new URL(req.url || '/', 'http://localhost').searchParams.get('server') ?? undefined;

    if (!authenticateFromRequest(ws, req)) return;
    ensureSubs(ws);
    if (!ws.userId) {
      ws.authTimeout = setTimeout(() => {
        if (ws.userId) return;
        sendSafe(ws, { type: 'error', error: 'Authentication timeout' });
        ws.close(1008, 'Authentication timeout');
      }, WS_AUTH_TIMEOUT_MS);
    }

    ws.gpClientId = crypto.randomUUID();

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data: RawData) => {
      try {
        const message = parseIncomingWebSocketMessage(data);
        await routeMessage(ws, message);
      } catch (error) {
        logError('WS:MESSAGE', error);
        sendSafe(ws, { type: 'error', error: 'Invalid message' });
      }
    });

    ws.on('close', () => {
      if (ws.authTimeout) {
        clearTimeout(ws.authTimeout);
        ws.authTimeout = undefined;
      }

      cleanupTerminalWs(ws);
      cleanupClient(ws);
    });

    ws.on('error', (error) => {
      logError('WS:CONNECTION', error);
    });
  });

  const shutdown = () => {
    clearInterval(heartbeatInterval);
    clearInterval(accessInterval);
    clearInterval(systemMetricsTimer);
    clearInterval(serverMetricsTimer);

    try {
      broadcaster.shutdown();
    } catch {
      // Ignore shutdown cleanup errors.
    }

    try {
      wss.close();
    } catch {
      // Ignore shutdown cleanup errors.
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function routeMessage(ws: AuthenticatedWebSocket, message: WSMessage): Promise<void> {
  // If not authenticated yet, only auth messages can authenticate
  if (!ws.userId) {
    if (!authenticateFromMessage(ws, message)) return;
    if (!(await ensureWsUserEnabled(ws))) return;
    if (ws.authTimeout) {
      clearTimeout(ws.authTimeout);
      ws.authTimeout = undefined;
    }
    sendSafe(ws, { type: 'auth:success' });
    return;
  }

  // Validate account state once per socket to reject disabled/deleted users.
  if (!(await ensureWsUserEnabled(ws))) return;
  if (!ws.isRoot || ws.runtimeScope !== undefined) {
    if (
      message.type === 'subscribe:system-metrics' ||
      ('serverId' in message &&
        message.serverId !== undefined &&
        !ws.visibleServers?.has(message.serverId))
    ) {
      sendSafe(ws, { type: 'error', error: 'Server access denied' });
      return;
    }
  }

  switch (message.type) {
    // Some clients may still send auth even if already authed via headers.
    // Return a success ack to keep auth handshakes idempotent.
    case 'auth':
      sendSafe(ws, { type: 'auth:success' });
      return;

    // Terminal messages must be routed to terminalWs
    case 'terminal:attach':
    case 'terminal:input':
    case 'terminal:resize': {
      // Apply a permission check whenever a server ID is available in the payload.
      if (message.serverId) {
        const ok = await hasServerPermission(ws, message.serverId, PERMISSIONS.container.terminal);
        if (!ok) {
          sendSafe(ws, {
            type: 'error',
            error: 'Insufficient server permissions',
          });
          return;
        }
      }

      await handleTerminalWsMessage(ws, message);
      return;
    }

    case 'subscribe:servers':
      await handleSubscribeServers(ws, message);
      return;

    case 'subscribe:logs': {
      const ok = await hasServerPermission(ws, message.serverId, PERMISSIONS.container.logsRead);
      if (!ok) {
        sendSafe(ws, {
          type: 'error',
          error: 'Insufficient server permissions',
        });
        return;
      }

      await handleSubscribeLogs(ws, message.serverId, message);
      return;
    }

    case 'subscribe:actions': {
      if (!(await hasServerPermission(ws, message.serverId, PERMISSIONS.container.logsRead))) {
        sendSafe(ws, {
          type: 'error',
          error: 'Insufficient server permissions',
        });
        return;
      }
      await handleSubscribeActions(ws, message.serverId, message);
      return;
    }

    case 'subscribe:file-transfers': {
      const ok = await hasServerPermission(ws, message.serverId, PERMISSIONS.fs.read);
      if (!ok) {
        sendSafe(ws, {
          type: 'error',
          error: 'Insufficient server permissions',
        });
        return;
      }

      await handleSubscribeFileTransfers(ws, message.serverId, message);
      return;
    }

    case 'subscribe:servers-metrics':
      await handleSubscribeServersMetrics(ws);
      return;

    case 'subscribe:system-metrics':
      await handleSubscribeSystemMetrics(ws, message);
      return;

    case 'subscribe:install': {
      if (!(await hasServerPermission(ws, message.serverId, PERMISSIONS.server.edit))) {
        sendSafe(ws, {
          type: 'error',
          error: 'Insufficient server permissions',
        });
        return;
      }
      await handleSubscribeInstall(ws, message.serverId);
      return;
    }

    case 'unsubscribe':
      await handleUnsubscribe(ws, message.channel, message.serverId);
      return;

    case 'ping':
      sendSafe(ws, { type: 'pong' });
      return;

    default:
      sendSafe(ws, { type: 'error', error: 'Unknown message type' });
  }
}
