import { bus } from '../realtime/bus.js';
import Docker from 'dockerode';
import { getConfig } from '../config.js';
import { serverRepository, actionsRepository } from '../database/index.js';
import { gameMonitoringRepository, type MonitoringRecord } from '../database/repositories/gameMonitoringRepository.js';
import { parseStoredPorts } from '../providers/runtimeConfig.js';
import type { GameServerRow } from '../types/gameServer.js';
import type { GameMonitoringConfig, GameMonitoringSettings, GameMonitoringSummary } from '../templates/types.js';
import { ownsContainer } from '../utils/docker/ownership.js';
import { logError } from '../utils/logger.js';
import { nativeOperationRunning } from './nativeOperationLock.js';
import { isPanelMaintenance } from './panelMaintenance.js';
import { advanceMonitoring, emptySnapshot, type Observation } from './gameMonitoringState.js';
import { queryGame } from './gameQuery.js';

// A stalled Docker daemon must not occupy every monitoring slot indefinitely.
const inspector = new Docker({ socketPath: getConfig().dockerSocket, timeout: 5000 });
function profile(server: GameServerRow) {
    const document = JSON.parse(server.provider_metadata_json || '{}')?.template?.document;
    const monitoring = document?.monitoring;
    const port = monitoring?.protocol === 'a2s'
        ? document.ports?.find((p: any) => p.key === monitoring.queryPort && p.protocol === 'udp') : null;
    return port && parseStoredPorts(server).udp.some(p => p.container === port.container) ? port : null;
}
export function monitoringDefaults(server: GameServerRow): GameMonitoringConfig {
    const port = profile(server);
    return { enabled: Boolean(port), protocol: 'a2s', queryPort: port?.container ?? null, intervalSeconds: 30, startupGraceSeconds: 90, failureThreshold: 3 };
}
export function validateMonitoringConfig(input: unknown, server: GameServerRow): GameMonitoringConfig {
    const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Invalid monitoring configuration');
    const c = input as GameMonitoringConfig;
    if (Object.keys(c).some(k => !['enabled', 'protocol', 'queryPort', 'intervalSeconds', 'startupGraceSeconds', 'failureThreshold'].includes(k))) return fail('Unknown monitoring field');
    if (typeof c.enabled !== 'boolean' || c.protocol !== 'a2s') return fail('Choose the A2S game query protocol');
    for (const [key, min, max] of [['intervalSeconds', 10, 300], ['startupGraceSeconds', 0, 900], ['failureThreshold', 1, 10]] as const) {
        if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max) return fail(`${key} must be an integer from ${min} to ${max}`);
    }
    if ((c.enabled || c.queryPort !== null) && !parseStoredPorts(server).udp.some(p => p.container === c.queryPort)) return fail('Select an allocated UDP query port');
    return { enabled: c.enabled, protocol: 'a2s', queryPort: c.queryPort, intervalSeconds: c.intervalSeconds, startupGraceSeconds: c.startupGraceSeconds, failureThreshold: c.failureThreshold };
}
export function monitoringSummary(record: MonitoringRecord, now = Date.now()): GameMonitoringSummary {
    const { config, snapshot } = record;
    const staleAfterSeconds = config.intervalSeconds * 3 + 10;
    const stale = snapshot.checkedAt && now - Date.parse(snapshot.checkedAt) > staleAfterSeconds * 1000;
    const state = !config.enabled ? 'disabled' : stale ? 'stale' : snapshot.state;
    return { ...snapshot, state, enabled: config.enabled, staleAfterSeconds,
        ...(state !== 'online' ? { info: null, latencyMs: null } : {}) };
}
export async function getMonitoringSettings(id: number): Promise<GameMonitoringSettings> {
    const server = await serverRepository.findById(id);
    if (!server) throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    const record = await gameMonitoringRepository.get(id) || { config: monitoringDefaults(server), snapshot: emptySnapshot(), revision: 0 };
    return { config: record.config, summary: monitoringSummary(record), ports: parseStoredPorts(server).udp, templateProfile: Boolean(profile(server)) };
}
export async function getMonitoringSummary(server: GameServerRow) {
    const record = await gameMonitoringRepository.get(server.id) || { config: monitoringDefaults(server), snapshot: emptySnapshot(), revision: 0 };
    const summary = monitoringSummary(record);
    if (summary.enabled && server.desired_state === 'stopped') return { ...summary, state: 'stopped' as const, info: null, latencyMs: null };
    return summary;
}
export async function configureMonitoring(id: number, input: unknown, actor: string) {
    const server = await serverRepository.findById(id);
    if (!server) throw Object.assign(new Error('Server not found'), { statusCode: 404 });
    const config = validateMonitoringConfig(input, server);
    const previous = await gameMonitoringRepository.get(id);
    await gameMonitoringRepository.configure(id, config, emptySnapshot());
    await actionsRepository.create(id, 'info', `Game monitoring ${config.enabled ? 'enabled / configured' : 'disabled'}.${previous?.snapshot.incidentStartedAt ? ' Previous incident closed by a configuration change; recovery not confirmed.' : ''}`, actor);
    bus.emit('server.monitoring', { serverId: id });
    return getMonitoringSettings(id);
}

export async function observeGame(server: GameServerRow, record: MonitoringRecord): Promise<Observation> {
    const base = { now: Date.now(), runtimeKey: record.snapshot.runtimeKey };
    if (isPanelMaintenance() || nativeOperationRunning(server.id) || ['creating', 'installing', 'stopping', 'restarting'].includes(server.status)) return { ...base, state: 'maintenance' };
    if (server.desired_state === 'stopped') return { ...base, state: 'stopped' };
    if (!server.docker_container_id) return { ...base, state: server.status === 'starting' ? 'starting' : 'result', error: 'Game container is missing' };
    const port = parseStoredPorts(server).udp.find(p => p.container === record.config.queryPort);
    if (!port) return { ...base, state: 'unavailable', error: 'The configured UDP port is no longer allocated' };
    let runtime: Docker.ContainerInspectInfo;
    try { runtime = await inspector.getContainer(server.docker_container_id).inspect(); }
    catch (error: any) {
        return { ...base, state: error.statusCode === 404 ? 'result' : 'unavailable', error: error.statusCode === 404 ? 'Game container is missing' : 'Docker inspection unavailable' };
    }
    if (!ownsContainer(runtime.Config.Labels || {})) return { ...base, state: 'unavailable', error: 'Container is not managed by this node' };
    const runtimeKey = `${runtime.Id}:${runtime.State.StartedAt}`;
    const current = { now: Date.now(), runtimeKey };
    if (!runtime.State.Running) return { ...current, state: 'result', error: 'Game container is not running' };
    if (runtime.State.Paused) return { ...current, state: 'maintenance' };
    if (Date.now() - Date.parse(runtime.State.StartedAt) < record.config.startupGraceSeconds * 1000) return { ...current, state: 'starting' };
    // All managed games and the backend share this node-local network. Query the
    // actual container address and its allocated internal port, never a guessed host port.
    const host = runtime.NetworkSettings.Networks[getConfig().gamesNetwork]?.IPAddress;
    if (!host) return { ...current, state: 'unavailable', error: 'Game container is not attached to the node game network' };
    try { return { ...current, state: 'result', ...await queryGame(host, port.container) }; }
    catch (error) { return { ...current, state: 'result', error: (error as Error).message }; }
}

export function startGameMonitoringWorker() {
    let stopped = false, scanning = false;
    const active = new Set<number>(), due = new Map<number, number>();
    const tick = async () => {
        if (stopped || scanning) return;
        scanning = true;
        try {
            const servers = await serverRepository.listAll();
            const ids = new Set(servers.map(s => s.id));
            for (const id of due.keys()) if (!ids.has(id)) due.delete(id);
            // Oldest due first: a large node cannot starve the tail of its server list.
            servers.sort((a, b) => (due.get(a.id) || 0) - (due.get(b.id) || 0));
            for (const server of servers) {
                if (stopped || active.size >= 8) break;
                if (active.has(server.id) || (due.get(server.id) || 0) > Date.now()) continue;
                active.add(server.id);
                void (async () => {
                    try {
                        const record = await gameMonitoringRepository.ensure(server.id, monitoringDefaults(server), emptySnapshot());
                        due.set(server.id, Date.now() + record.config.intervalSeconds * 1000);
                        if (!record.config.enabled || stopped) return;
                        const observation = await observeGame(server, record);
                        // A stop/recreate or maintenance operation may have begun during UDP IO.
                        const fresh = await serverRepository.findById(server.id);
                        if (stopped || !fresh || fresh.docker_container_id !== server.docker_container_id || fresh.desired_state !== server.desired_state || fresh.status !== server.status || fresh.updated_at !== server.updated_at || fresh.ports_json !== server.ports_json || (observation.state !== 'maintenance' && (nativeOperationRunning(server.id) || isPanelMaintenance()))) return;
                        const { snapshot, event } = advanceMonitoring(record.snapshot, record.config, observation);
                        if (await gameMonitoringRepository.observe(server.id, record.revision, snapshot)) {
                            bus.emit('server.monitoring', { serverId: server.id });
                            if (event) await actionsRepository.create(server.id, event.level, event.message, 'monitor');
                        }
                    } catch (error) { logError('GAME:MONITOR', error, { serverId: server.id }); due.set(server.id, Date.now() + 30000); }
                    finally { active.delete(server.id); }
                })();
            }
        } catch (error) { logError('GAME:MONITOR:SCAN', error); }
        finally { scanning = false; }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return { stop() { stopped = true; clearInterval(timer); } };
}
