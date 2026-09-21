import { useEffect, useState } from 'react';
import { Cpu, ChevronDown, RefreshCw, Check, Loader2 } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { ACTIVE_NODE } from '../../utils/nodeContext';
import './cpu-binding.css';

export type CpuTopology = {
  cpuBindingProtocol: number; model: string; availableCpuIds: number[];
  cores: { socketId: number; coreId: number; cpuIds: number[] }[];
  checkedAt: string; unboundContainerCount: number;
  assignments: { serverId: number | null; containerId: string | null; name: string; source: string; state: string; configuredCpuSet: number[]; effectiveCpuSet: number[]; pendingCpuSet: number[] | null }[];
};
export function CpuBindingPicker({ value, onChange, nodeId = ACTIVE_NODE, serverId, disabled = false, refreshKey = 0 }: {
  value: number[]; onChange: (ids: number[]) => void; nodeId?: string; serverId?: number; disabled?: boolean; refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [data, setData] = useState<CpuTopology | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    apiClient.getAvailableCpus(nodeId, serverId).then(result => {
      if (result.cpuBindingProtocol !== 1 || !Array.isArray(result.cores)) throw new Error('Update this node to enable CPU binding.');
      if (active) setData(result);
    }).catch(e => { if (active) setError(e.message || 'Cannot load CPU binding on this node.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [nodeId, serverId, refresh, refreshKey]);
  const toggle = (ids: number[]) => {
    const remove = ids.every(id => value.includes(id));
    onChange((remove ? value.filter(id => !ids.includes(id)) : [...new Set([...value, ...ids])]).sort((a, b) => a - b));
  };
  const unavailable = data ? value.filter(id => !data.availableCpuIds.includes(id)) : [];
  return <div className="gp-cpu-binding">
    <span className="gp-cpu-label">CPU binding</span>
    <button type="button" className="gp-cpu-trigger" aria-expanded={open} onClick={() => { if (!open) setRefresh(v => v + 1); setOpen(v => !v); }} disabled={disabled}>
      <Cpu size={18} /><span>{value.length ? `CPU ${value.join(', ')}` : 'No binding'}</span><ChevronDown size={16} />
    </button>
    <small>Choose where this server can run. vCPU remains a separate limit.</small>
    {open && <div className="gp-cpu-panel">
      <div className="gp-cpu-toolbar">
        <div><strong>{data?.model || 'Node processors'}</strong>{data && <small>{data.cores.length} physical cores · {data.availableCpuIds.length} logical CPUs</small>}</div>
        <button type="button" aria-label="Refresh CPU assignments" onClick={() => setRefresh(v => v + 1)} disabled={loading || disabled}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      <div className="gp-cpu-actions">
        <button type="button" onClick={() => onChange([])} disabled={disabled} aria-pressed={!value.length}>No binding</button>
        <button type="button" onClick={() => setAdvanced(v => !v)} aria-pressed={advanced}>Individual threads</button>
      </div>
      {loading && <p role="status"><Loader2 size={16} className="animate-spin" /> Loading CPU assignments…</p>}
      {error && <p role="alert">{error}</p>}
      {unavailable.length > 0 && <p role="alert">Unavailable CPUs: {unavailable.join(', ')}. Select available CPUs before saving.</p>}
      {data && <>
        <div className="gp-cpu-grid">{data.cores.map(core => {
          const selected = core.cpuIds.every(id => value.includes(id));
          const partial = !selected && core.cpuIds.some(id => value.includes(id));
          const assigned = data.assignments.filter(a => [...a.configuredCpuSet, ...a.effectiveCpuSet, ...(a.pendingCpuSet || [])].some(id => core.cpuIds.includes(id)));
          return <div className={`gp-cpu-core ${selected ? 'is-selected' : partial ? 'is-partial' : ''}`} key={`${core.socketId}:${core.coreId}`}>
            <button type="button" className="gp-cpu-core-select" aria-label={`Socket ${core.socketId} core ${core.coreId}, CPU ${core.cpuIds.join(',')}`} aria-pressed={partial ? 'mixed' : selected} onClick={() => toggle(core.cpuIds)} disabled={disabled}>
              <span><strong>Core {core.coreId}{data.cores.some(c => c.socketId !== core.socketId) ? ` · Socket ${core.socketId}` : ''}</strong><small>CPU {core.cpuIds.join(', ')}</small></span>
              <span className="gp-cpu-check">{selected ? <Check size={15} /> : partial ? '−' : ''}</span>
            </button>
            {advanced && <div className="gp-cpu-threads">{core.cpuIds.map(id => <button type="button" key={id} aria-pressed={value.includes(id)} disabled={disabled} onClick={() => toggle([id])}>CPU {id}</button>)}</div>}
            <div className="gp-cpu-assigned">{assigned.length ? assigned.map(a => {
              const pending = a.pendingCpuSet !== null;
              const actualOnCore = a.effectiveCpuSet.some(id => core.cpuIds.includes(id));
              const configuredOnCore = a.configuredCpuSet.some(id => core.cpuIds.includes(id));
              return <div key={a.serverId ? `server-${a.serverId}` : a.containerId}>
                <span title={a.name}>{a.name}{a.serverId === serverId ? ' · this server' : ''}</span>
                <small>{a.source === 'external' ? 'External · ' : ''}{a.state}{!actualOnCore && configuredOnCore ? ' · configured' : ''}{pending ? ` · next restart: ${a.pendingCpuSet!.join(', ') || 'no binding'}` : ''}</small>
              </div>;
            }) : <small>No explicit assignments</small>}</div>
          </div>;
        })}</div>
        <p className="gp-cpu-note">Multiple servers may share a core. {data.unboundContainerCount} running containers have no binding and can also use these CPUs.</p>
      </>}
    </div>}
  </div>;
}
