import WebSocket, { type WebSocketServer } from 'ws';
import { serverRepository, serverMetricsRepository } from '../../database/index.js';
import * as dockerUtils from '../../utils/docker.js';
import type { AuthenticatedWebSocket } from '../types.js';
import { sendSafe } from '../auth.js';
import { round2 } from '../../utils/number.js';
import { logError } from '../../utils/logger.js';
import { nowIso } from '../../utils/time.js';
import { getCachedServerStorageDiskUsagePercent } from '../../utils/diskUsage.js';
import {
    getServerMetricsSamples,
    retainServerMetricsSamples,
    setServerMetricsSample,
} from '../../utils/serverMetricsCache.js';

const RETENTION_DAYS = 1;
const PRUNE_EVERY_MS = 30 * 60_000;
let lastPruneAt = 0;

type ServerMetricsPollerOptions = {
    intervalMs?: number;
};

function broadcastServerMetrics(wss: WebSocketServer): void {
    const payload = {
        type: 'servers-metrics:update',
        metrics: getServerMetricsSamples(),
        timestamp: nowIso(),
    } as const;

    wss.clients.forEach((client) => {
        const ws = client as AuthenticatedWebSocket;
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!ws.userId) return;
        if (!ws.subs?.serversMetrics) return;

        sendSafe(ws, payload);
    });
}

export function startServerMetricsPoller(wss: WebSocketServer, opts?: ServerMetricsPollerOptions): NodeJS.Timeout {
    const intervalMs = opts?.intervalMs ?? 10_000;

    const timer = setInterval(async () => {
        try {
            const now = Date.now();
            if (now - lastPruneAt > PRUNE_EVERY_MS) {
                lastPruneAt = now;
                try {
                    await serverMetricsRepository.pruneOlderThanDays(RETENTION_DAYS);
                } catch (e) {
                    logError('WS:POLLER:SERVER_METRICS_PRUNE', e);
                }
            }

            const runningServers = await serverRepository.findRunningServers();
            retainServerMetricsSamples(runningServers.map((server) => server.id));

            for (const server of runningServers) {
                if (!server?.docker_container_id) continue;

                let containerStatus = 'unknown';
                try {
                    containerStatus = await dockerUtils.checkContainerStatus(server.docker_container_id);
                } catch {
                    continue;
                }
                if (containerStatus !== 'running') continue;

                const stats = await dockerUtils.getContainerStats(server.docker_container_id);

                const diskUsage = await getCachedServerStorageDiskUsagePercent(server.id);

                // Store one row per tick. Disk is cached and refreshed independently.
                await serverMetricsRepository.create(
                    server.id,
                    stats.cpuUsage,
                    stats.memoryUsage,
                    diskUsage,
                    stats.networkUsage.in,
                    stats.networkUsage.out
                );

                setServerMetricsSample(server.id, {
                    cpuUsage: round2(stats.cpuUsage), // %
                    memoryUsage: round2(stats.memoryUsage), // %
                    diskUsage: round2(diskUsage), // %
                    network: stats.networkUsage, // bytes/s
                });
            }

            broadcastServerMetrics(wss);
        } catch (error) {
            logError('WS:POLLER:SERVER_METRICS', error);
        }
    }, intervalMs);

    return timer;
}
