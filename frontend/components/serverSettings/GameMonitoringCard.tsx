import { useEffect, useState } from 'react';
import { Activity, Save } from 'lucide-react';
import { AppButton, AppSelect, AppToggle } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import type { GameMonitoringConfig, GameMonitoringSettings } from '../../../backend/src/templates/types';
import { GameMonitoringStatus } from '../GameMonitoringStatus';
import './fastdownload.css';

export function GameMonitoringCard({ serverId }: { serverId: number }) {
    const [data, setData] = useState<GameMonitoringSettings | null>(null);
    const [draft, setDraft] = useState<GameMonitoringConfig | null>(null);
    const [error, setError] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true, loading = false;
        setData(null); setDraft(null); setError(''); setSaved(false);
        const refresh = async () => {
            if (loading) return;
            loading = true;
            try {
                const next = await apiClient.getMonitoring(serverId);
                if (active) { setData(next); setDraft(previous => previous || next.config); setError(''); }
            } catch (e: any) { if (active) setError(e.response?.data?.error || 'Could not load game monitoring. The node may need an update.'); }
            finally { loading = false; }
        };
        void refresh();
        const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
        return () => { active = false; clearInterval(timer); };
    }, [serverId]);
    const change = (patch: Partial<GameMonitoringConfig>) => { setDraft(d => d ? { ...d, ...patch } : d); setSaved(false); };
    const save = async () => {
        if (!draft) return;
        setBusy(true); setError(''); setSaved(false);
        try { const next = await apiClient.updateMonitoring(serverId, draft); setData(next); setDraft(next.config); setSaved(true); }
        catch (e: any) { setError(e.response?.data?.error || 'Could not confirm monitoring settings. Refresh before retrying.'); }
        finally { setBusy(false); }
    };
    return <section className="gp-settings-card gp-monitor-card" aria-label="Game monitoring">
        <div className="gp-fdl-heading">
            <div className="gp-fdl-title"><span className="gp-fdl-icon"><Activity size={21} /></span><div><h4>Game monitoring</h4><p>Game response, map and players</p></div></div>
            {draft && <AppToggle label="Enable game monitoring" checked={draft.enabled} disabled={busy || (!data?.ports.length && !draft.enabled)} onChange={enabled => change({ enabled, queryPort: data?.ports.some(p => p.container === draft.queryPort) ? draft.queryPort : data?.ports[0]?.container ?? null })} />}
        </div>
        {!data && !error && <p role="status">Loading game monitoring…</p>}
        {data && draft && <>
            <GameMonitoringStatus summary={data.summary} detailed />
            <p>Checks run on this node even when the panel is closed. A2S supports Counter-Strike 1.6 / ReHLDS and compatible Source games.</p>
            {!data.ports.length ? <p>No UDP ports are allocated to this server.</p> : <>
                <AppSelect controlLabel="Game query port" value={String(draft.queryPort ?? '')} disabled={busy} placeholder="Select a UDP query port"
                    options={data.ports.map(p => ({ value: String(p.container), label: `${p.label || 'UDP'} · ${p.host} → ${p.container}` }))}
                    onChange={value => change({ queryPort: Number(value) })} />
                <div className="gp-monitor-fields">
                    {([{ key: 'intervalSeconds', label: 'Check interval (seconds)', min: 10, max: 300 }, { key: 'startupGraceSeconds', label: 'Startup grace (seconds)', min: 0, max: 900 }, { key: 'failureThreshold', label: 'Failures before incident', min: 1, max: 10 }] as const).map(f => <label key={f.key}>{f.label}<input type="number" min={f.min} max={f.max} step="1" value={Number.isNaN(draft[f.key]) ? '' : draft[f.key]} disabled={busy} onChange={e => change({ [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>)}
                </div>
            </>}
            <p>Outages and recoveries appear in Activity. Checks use the node’s internal game network; they do not test the public connection from a player’s location.</p>
            <AppButton onClick={() => void save()} disabled={busy || !Number.isInteger(draft.intervalSeconds) || !Number.isInteger(draft.startupGraceSeconds) || !Number.isInteger(draft.failureThreshold) || (draft.enabled && !draft.queryPort)}><Save size={16} />{busy ? 'Saving…' : 'Save monitoring settings'}</AppButton>
        </>}
        {saved && <p role="status">Monitoring settings saved.</p>}
        {error && <p role="alert" className="text-red-400">{error}</p>}
    </section>;
}
