import { Activity, MapPin, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GameMonitoringSummary } from '../../backend/src/templates/types';
import './gameMonitoring.css';

const labels = { disabled: 'Monitoring off', waiting: 'Waiting for first check', starting: 'Game starting', online: 'Game responding', degraded: 'Verifying game response', offline: 'Game not responding', stopped: 'Game stopped', maintenance: 'Planned operation', unavailable: 'Monitoring unavailable', stale: 'No recent game data' };
export function GameMonitoringStatus({ summary, runtimeStatus, detailed = false }: { summary?: GameMonitoringSummary; runtimeStatus?: string; detailed?: boolean }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
    if (!summary?.enabled) return null;
    const stale = summary.checkedAt && now - Date.parse(summary.checkedAt) > summary.staleAfterSeconds * 1000;
    const state = runtimeStatus === 'unknown' ? 'unavailable' : runtimeStatus === 'stopped' && summary.state !== 'offline' ? 'stopped'
        : ['starting', 'restarting', 'stopping', 'installing'].includes(runtimeStatus || '') ? 'starting' : stale ? 'stale' : summary.state;
    const info = state === 'online' ? summary.info : null;
    return <div className={`gp-game-monitor ${detailed ? 'gp-game-monitor-detailed' : ''}`} data-state={state}>
        <span className="gp-game-monitor-state"><Activity size={14} aria-hidden="true" />{labels[state]}</span>
        {info && <div className="gp-game-monitor-info">
            <span><MapPin size={13} aria-hidden="true" /><span>{info.map || 'Unknown map'}</span></span>
            <span><Users size={13} aria-hidden="true" />{info.players} / {info.maxPlayers}</span>
        </div>}
        {detailed && <>
            {summary.checkedAt && <small>Last check: {new Date(summary.checkedAt).toLocaleTimeString()}{info && summary.latencyMs !== null ? ` · ${summary.latencyMs} ms` : ''}</small>}
            {state === 'degraded' && <small>{summary.failures} unsuccessful check{summary.failures === 1 ? '' : 's'}</small>}
            {summary.error && !['online', 'stopped', 'starting', 'maintenance', 'stale'].includes(state) && <small>{summary.error}</small>}
        </>}
    </div>;
}
