import Docker from 'dockerode';
import { getConfig } from '../config.js';
import { ownsContainer } from '../utils/docker/ownership.js';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/init.js';
import { actionsRepository, serverRepository } from '../database/index.js';
import { gameMonitoringRepository, type MonitoringRecord } from '../database/repositories/gameMonitoringRepository.js';
import { enterServerMutation } from './nativeOperationLock.js';
import { isPanelMaintenance } from './panelMaintenance.js';
import { restartServer } from './restartServer.js';
import { clearServerTransition, reconcileServerStatus } from './serverTransitions.js';
import type { AutoRestartConfig, GameMonitoringConfig } from '../templates/types.js';
const inspector = new Docker({ socketPath: getConfig().dockerSocket, timeout: 5000 });
export const DEFAULT_AUTO_RESTART: AutoRestartConfig = { enabled: false, cooldownSeconds: 300, maxAttempts: 2, windowSeconds: 3600 };
export function validateAutoRestart(value: unknown): AutoRestartConfig {
    if (value === undefined) return { ...DEFAULT_AUTO_RESTART };
    const c = value as AutoRestartConfig;
    const fail = (): never => { throw Object.assign(new Error('Invalid automatic restart settings: cooldown 60–3600 seconds, 1–5 attempts, window 900–86400 seconds'), { statusCode: 400 }); };
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !['enabled','cooldownSeconds','maxAttempts','windowSeconds'].includes(k)) || typeof c.enabled !== 'boolean') return fail();
    for (const [key,min,max] of [['cooldownSeconds',60,3600],['maxAttempts',1,5],['windowSeconds',900,86400]] as const) if (!Number.isInteger(c[key]) || c[key]<min || c[key]>max) return fail();
    if (c.cooldownSeconds > c.windowSeconds) return fail();
    return { enabled: c.enabled, cooldownSeconds: c.cooldownSeconds, maxAttempts: c.maxAttempts, windowSeconds: c.windowSeconds };
}
export function recoveryDecision(config: GameMonitoringConfig, record: MonitoringRecord, times: number[], now: number): boolean {
    const c = config.autoRestart || DEFAULT_AUTO_RESTART;
    const recent = times.filter(t => now-t < c.windowSeconds*1000);
    return config.enabled && c.enabled && record.snapshot.state === 'offline' && Boolean(record.snapshot.incidentStartedAt)
        && record.snapshot.failures >= config.failureThreshold && !!record.snapshot.checkedAt
        && now-Date.parse(record.snapshot.checkedAt) <= (config.intervalSeconds*3+10)*1000
        && recent.length < c.maxAttempts && times.every(t => now-t >= c.cooldownSeconds*1000);
}
export async function recoverySummary(id: number, config: GameMonitoringConfig) {
    const db = await getDatabase(), c = config.autoRestart || DEFAULT_AUTO_RESTART, now = Date.now();
    const rows = await db.all('SELECT created_at,state,result FROM monitoring_restarts WHERE server_id=? AND created_at>? ORDER BY created_at DESC', id, now-86400000);
    const recent = rows.filter(r => now-r.created_at < c.windowSeconds*1000);
    const next = Math.max(rows[0] ? rows[0].created_at+c.cooldownSeconds*1000 : 0, recent.length >= c.maxAttempts ? recent[c.maxAttempts-1].created_at+c.windowSeconds*1000 : 0);
    return { supported: true as const, attemptsInWindow: recent.length, nextAttemptAt: next>now ? new Date(next).toISOString() : null, lastResult: rows[0]?.result || null };
}
export async function recoverRestartAttempts() {
    const db = await getDatabase();
    const rows = await db.all("SELECT id,server_id FROM monitoring_restarts WHERE state='running'");
    for (const row of rows) {
        await db.run("UPDATE monitoring_restarts SET state='unknown',result='Agent stopped during restart; attempt retained in limit' WHERE id=?",row.id);
        await actionsRepository.create(row.server_id,'warning','Automatic restart outcome unknown: agent stopped during the attempt. No immediate replay.','monitor');
    }
}
export async function maybeRestartGame(id: number, revision: number, expectedRuntime: string | null) {
    let release: (() => void) | undefined;
    try { release = enterServerMutation(id); } catch { return; }
    try {
        const db = await getDatabase();
        const server = await serverRepository.findById(id), record = await gameMonitoringRepository.get(id);
        if (!server || !record || record.revision !== revision || record.snapshot.runtimeKey !== expectedRuntime || server.desired_state !== 'running'
            || !server.docker_container_id || !['running','unhealthy','stopped','error','exited'].includes(server.status) || isPanelMaintenance()) return;
        const times = (await db.all('SELECT created_at FROM monitoring_restarts WHERE server_id=? AND created_at>?',id,Date.now()-86400000)).map(r => r.created_at);
        if (!recoveryDecision(record.config, record, times, Date.now())) return;
        // Docker may have restarted the process independently since the failed query.
        let runtime: Docker.ContainerInspectInfo;
        try { runtime = await inspector.getContainer(server.docker_container_id).inspect(); } catch { return; }
        if (!ownsContainer(runtime.Config.Labels || {}) || runtime.State.Paused || runtime.State.Restarting
            || `${runtime.Id}:${runtime.State.StartedAt}` !== expectedRuntime) return;
        if (runtime.State.Running && Date.now()-Date.parse(runtime.State.StartedAt) < record.config.startupGraceSeconds*1000) return;
        const attempt = randomUUID();
        // Persist BEFORE contacting Docker. An interrupted/uncertain request still consumes the budget.
        await db.run("INSERT INTO monitoring_restarts(id,server_id,created_at,state) VALUES(?,?,?,'running')",attempt,id,Date.now());
        await actionsRepository.create(id,'warning',`Automatic restart started: game failed ${record.snapshot.failures} checks. Attempt ${times.filter(t => Date.now()-t < (record.config.autoRestart!.windowSeconds)*1000).length+1}/${record.config.autoRestart!.maxAttempts} in the configured window.`,'monitor');
        try {
            if (isPanelMaintenance()) throw new Error('Panel maintenance started');
            // Automatic recovery must not silently apply unrelated pending configuration.
            await restartServer(id, false);
            await db.run("UPDATE monitoring_restarts SET state='completed',result='Restart request completed; awaiting game response' WHERE id=?",attempt);
            await actionsRepository.create(id,'info','Automatic restart completed: waiting for A2S to confirm game recovery.','monitor');
        } catch {
            await db.run("UPDATE monitoring_restarts SET state='failed',result='Restart could not be confirmed; attempt retained in limit' WHERE id=?",attempt);
            clearServerTransition(id); await reconcileServerStatus(id).catch(() => {});
            await actionsRepository.create(id,'error','Automatic restart failed: check the server and node. The attempt counts toward the restart limit.','monitor');
        }
        await db.run('DELETE FROM monitoring_restarts WHERE created_at<?',Date.now()-7*86400000);
    } finally { release?.(); }
}
