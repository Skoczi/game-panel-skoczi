import type { GameMonitoringConfig, GameMonitoringSnapshot, GameQueryInfo } from '../templates/types.js';

export const emptySnapshot = (): GameMonitoringSnapshot => ({ state: 'waiting', checkedAt: null, lastSuccessAt: null, failures: 0, incidentStartedAt: null, error: null, info: null, latencyMs: null, runtimeKey: null });
export type Observation = { now: number; runtimeKey: string | null } & (
    { state: 'starting' | 'stopped' | 'maintenance' | 'unavailable'; error?: string }
    | { state: 'result'; info?: GameQueryInfo; latencyMs?: number; error?: string }
);
export function advanceMonitoring(previous: GameMonitoringSnapshot, config: GameMonitoringConfig, observation: Observation) {
    const timestamp = new Date(observation.now).toISOString();
    const next: GameMonitoringSnapshot = { ...previous, checkedAt: timestamp, runtimeKey: observation.runtimeKey, info: null, latencyMs: null, error: observation.error || null };
    let event: { level: string; message: string } | null = null;
    if (observation.state !== 'result') {
        next.state = observation.state;
        // Docker/API errors are gaps in observation, never evidence of a game outage.
        if (observation.state === 'unavailable') next.failures = 0;
        if (observation.state !== 'unavailable') {
            next.failures = 0;
            if (previous.incidentStartedAt && observation.state !== 'starting') {
                event = { level: 'info', message: `Game monitoring incident ended: ${observation.state}. Recovery was not confirmed.` };
                next.incidentStartedAt = null;
            }
        }
    } else if (observation.info) {
        next.state = 'online'; next.failures = 0; next.error = null;
        next.info = observation.info; next.latencyMs = observation.latencyMs ?? null;
        next.lastSuccessAt = timestamp; next.incidentStartedAt = null;
        if (previous.incidentStartedAt) event = { level: 'success', message: `Game response recovered after ${Math.max(0, Math.round((observation.now - Date.parse(previous.incidentStartedAt)) / 1000))} seconds. Map: ${observation.info.map}; players: ${observation.info.players}/${observation.info.maxPlayers}.` };
    } else {
        // Do not join failures across a stopped agent or a long observation gap.
        const recent = previous.runtimeKey === observation.runtimeKey && previous.checkedAt && observation.now - Date.parse(previous.checkedAt) <= (config.intervalSeconds * 3 + 10) * 1000;
        next.failures = (recent ? previous.failures : 0) + 1;
        next.state = previous.incidentStartedAt || next.failures >= config.failureThreshold ? 'offline' : 'degraded';
        if (next.state === 'offline' && !previous.incidentStartedAt) {
            next.incidentStartedAt = timestamp;
            event = { level: 'error', message: `Game is not responding after ${next.failures} consecutive checks. ${next.error || ''}`.trim() };
        }
    }
    return { snapshot: next, event };
}
