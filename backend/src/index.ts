import { fastDownloadPublic } from './routes/fastDownload.js';
import { startFastDownloadWorker } from './services/fastDownload.js';
import { isPanelMaintenance, activePanelRequests, trackPanelMutation } from './services/panelMaintenance.js';
import { activeServerOperations } from './services/nativeOperationLock.js';
import { runtimeCapabilities } from './utils/runtimeCapabilities.js';
import { initializePublicApi, apiTokenRoutes, publicApiRoutes } from './services/publicApiControl.js';
import { publicApiErrorHandler } from './routes/publicApi.js';
import { requestContext } from './middleware/requestContext.js';
import { recoverRestoreTransactions } from './services/nativeRestoreRecovery.js';
import { getConfig } from './config.js';
import { initializeTemplates, templateRoutes } from './templates/routes.js';
import { recoverNativeOperations } from './services/nativeRuntime.js';
import cors, { type CorsOptions } from 'cors';
import express, {
  type Application,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import brandingRoutes from './routes/branding.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import {
  reconcileDockerHealthToDb,
  startDockerHealthEventListener,
  startPeriodicHealthReconcile,
} from './services/dockerEvents.js';
import { closeDatabase, initializeDatabase } from './database/init.js';
import { ensureRootUserExists } from './database/bootstrap.js';
import { initializeGlobalSettings } from './services/globalSettings.js';
import { authMiddleware, errorHandler } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import serverMembersRoutes from './routes/serverMembers.js';
import serverRoutes from './routes/servers.js';
import systemRoutes from './routes/system.js';
import catalogRoutes from './routes/catalog.js';
import downloadRoutes from './routes/download.js';
import { setupWebSocket } from './websocket/handler.js';
import { getAppVersion, getRuntimeBuild } from './utils/appInfo.js';
import { logError, logInfo } from './utils/logger.js';
import { reconcileGamesNetwork } from './utils/docker.js';
import { startLinuxGsmManifestRefreshJob } from './services/linuxGsmManifest.js';
import { startFileTransferCleanupJob } from './services/fileTransfers.js';
import { startDownloadTokenCleanupJob } from './services/downloadTokens.js';
import { startScheduledTaskRunner } from './services/scheduledTasks.js';
import { reconcileStalePanelUpdate } from './services/panelUpdates.js';
import { nowIso } from './utils/time.js';
import { isAgent } from './agent/identity.js';
import {
  initializeFleet,
  mountFleet,
  localFleetGuard,
} from './fleet/control.js';
import {
  agentGate,
  agentIdempotency,
  authorizeAgent,
  initializeAgent,
  startAgentHeartbeat,
} from './agent/runtime.js';
import {
  createNodeWebSocketRouter,
  initializeNodes,
  mountNodeControl,
} from './nodes/control.js';

const { port, frontendUrl, trustProxy } = getConfig();
const API_BODY_LIMIT = '2mb';

const app: Application = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
const closeNodeSockets = createNodeWebSocketRouter(
  httpServer,
  wss,
  isAgent() ? authorizeAgent : undefined,
);

function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

const configuredOrigin = toOrigin(frontendUrl);
if (!configuredOrigin) {
  throw new Error('DOMAIN must produce a valid frontend origin');
}
const allowedOrigins = new Set<string>([configuredOrigin]);

let dockerHealthListener: { stop: () => void } | null = null;
let periodicHealthReconcile: { stop: () => void } | null = null;
let linuxGsmRefreshJob: { stop: () => void } | null = null;
let fileTransferCleanupJob: { stop: () => void } | null = null;
let downloadTokenCleanupJob: { stop: () => void } | null = null;
let fastDownloadWorker: { stop: () => void } | null = null;
let scheduledTaskRunner: { stop: () => void } | null = null;
let agentHeartbeat: { stop: () => void } | null = null;

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Requests like curl/Postman may not send an Origin header.
    if (!origin) return callback(null, true);

    const requestOrigin = toOrigin(origin);
    const isAllowed = !!requestOrigin && allowedOrigins.has(requestOrigin);

    if (isAllowed) return callback(null, true);
    return callback(new Error('CORS not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  exposedHeaders: ['ETag', 'X-Request-ID', 'Retry-After', 'Location', 'Idempotency-Replayed'],
};

app.set('trust proxy', trustProxy);

app.use(requestContext);
app.use(helmet());
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (isPanelMaintenance()) return res.status(503).json({ error: 'Panel update in progress. Wait for it to finish before making changes.' });
  const release = trackPanelMutation();
  res.once('finish', release); res.once('close', release);
  next();
});

app.use('/fdl', fastDownloadPublic);

// Agent gate and remote proxy precede parsers so uploads remain streaming.
if (isAgent()) app.use(agentGate);
else {
  mountNodeControl(app);
  mountFleet(app);
}

// CORS + preflight
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Body parsers
app.use(express.json({ limit: API_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: API_BODY_LIMIT }));
if (isAgent())
  app.use((req, res, next) => {
    void agentIdempotency(req, res, next).catch(next);
  });

// /api/auth
app.use('/api/auth', authRoutes);
if (!isAgent()) {
  app.use('/api/v1', publicApiRoutes);
  app.use('/api/v1', publicApiErrorHandler);
  app.use('/api/api-tokens', authMiddleware, apiTokenRoutes);
}
app.use('/api/branding', brandingRoutes);
// /api/download/:token
app.use('/api/download', downloadRoutes);
// /api/users
app.use('/api/users', authMiddleware, userRoutes);
// /api/servers/:id/members
app.use(
  '/api/servers',
  authMiddleware,
  ...(isAgent() ? [] : [localFleetGuard]),
  serverMembersRoutes,
  serverRoutes,
);
// /api/catalog
app.use('/api/catalog', authMiddleware, catalogRoutes);
if (!isAgent()) app.use('/api/game-templates', authMiddleware, templateRoutes);
// /api/system
app.use('/api/system', authMiddleware, systemRoutes);

// GET /api/health
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ updateDrain: { maintenance: isPanelMaintenance(), busy: activePanelRequests() + activeServerOperations() }, ...getRuntimeBuild(), capabilities: runtimeCapabilities, status: 'healthy', timestamp: nowIso(), templatesProtocol: 1, nativeRuntimeProtocol: 1, templateScriptsProtocol: 1, nativeSettingsProtocol: 1, portAllocationProtocol: 1 });
});

// GET /api/version
app.get('/api/version', (_req: Request, res: Response) => {
  const { instanceId } = getConfig();
  res.json({
    version: getAppVersion(),
    instanceId,
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler
app.use(errorHandler);

// WebSocket server
setupWebSocket(wss);

// Bootstraps the app: database init + HTTP server start.
async function startServer(): Promise<void> {
  try {
    logInfo('APP', 'Initializing database...');
    await initializeDatabase();
    await initializeGlobalSettings();
    await ensureRootUserExists();
    if (isAgent()) {
      await initializeAgent();
      agentHeartbeat = startAgentHeartbeat();
    } else {
      await initializeNodes();
      await initializeTemplates();
      await initializeFleet();
      await initializePublicApi();
    }
    logInfo('APP', 'Database initialized');

    // Sync current Docker health -> DB once at boot
    await reconcileDockerHealthToDb();
    await recoverNativeOperations();
    await recoverRestoreTransactions();

    // Make sure the games network exists and every game container sits on it
    await reconcileGamesNetwork().catch((error) => {
      logError('APP:STARTUP:GAMES_NETWORK', error);
    });

    // Clear a panel update job left dangling by an interrupted updater
    await reconcileStalePanelUpdate().catch((error) => {
      logError('APP:STARTUP:PANEL_UPDATE_RECONCILE', error);
    });

    // Then listen to live Docker health changes
    dockerHealthListener = startDockerHealthEventListener();
    periodicHealthReconcile = startPeriodicHealthReconcile();
    linuxGsmRefreshJob = startLinuxGsmManifestRefreshJob();
    fileTransferCleanupJob = startFileTransferCleanupJob();
    downloadTokenCleanupJob = startDownloadTokenCleanupJob();
    scheduledTaskRunner = startScheduledTaskRunner();
    fastDownloadWorker = startFastDownloadWorker();

    httpServer.listen(port, () => {
      logInfo('APP', 'Game Panel backend listening on port ' + port);
    });
  } catch (error) {
    logError('APP:STARTUP', error);
    process.exit(1);
  }
}

// Gracefully closes the HTTP server and exits the process.
let shuttingDown = false;

function setupGracefulShutdown(): void {
  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;

    logInfo('APP', `${signal} received, shutting down gracefully...`);

    try {
      // 1) Stop docker listener
      dockerHealthListener?.stop();
      periodicHealthReconcile?.stop();
      linuxGsmRefreshJob?.stop();
      fileTransferCleanupJob?.stop();
      downloadTokenCleanupJob?.stop();
      scheduledTaskRunner?.stop();
      fastDownloadWorker?.stop();
      agentHeartbeat?.stop();
      closeNodeSockets();

      // 2) Close WebSocket clients then server
      wss.clients.forEach((ws) => {
        try {
          ws.close(1001, 'Server shutting down');
        } catch {
          // Ignore close errors from already-closed sockets.
        }
      });

      await new Promise<void>((resolve) => wss.close(() => resolve()));

      // 3) Stop accepting new HTTP connections
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));

      // 4) Close DB connection (if you keep a singleton)
      await closeDatabase();

      logInfo('APP', 'Server closed');
      process.exit(0);
    } catch (err) {
      logError('APP:SHUTDOWN', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

setupGracefulShutdown();
function registerGlobalErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    logError('APP:UNHANDLED_REJECTION', reason);
  });

  process.on('uncaughtException', (error) => {
    logError('APP:UNCAUGHT_EXCEPTION', error);
  });
}

registerGlobalErrorHandlers();
startServer();
