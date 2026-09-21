import { DeleteServerSection } from './DeleteServerSection';
// Modified by Skoczi: retain and edit host IPv4 allocations without widening bindings.
import './container-settings.css';
import { gameStartup, formatStartup, parseStartup, applyStartupOverride } from '../../../backend/src/templates/startupCommand';
import { WorkspaceModalOverlay } from './WorkspaceModalOverlay';
import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Save, AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { NativeRuntimeCard } from './NativeRuntimeCard';
import type { GameTemplate } from '../../utils/gameTemplates';

type PortEntry = { host: string; container: string; label: string; hostIp?: string };
type EnvEntry = { key: string; value: string };
type MountEntry = { key: string; containerPath: string };
type HealthcheckMode = 'image_default' | 'disabled' | 'override';
type HealthcheckOverrideType = 'tcp_connect' | 'process' | 'command';

interface HealthcheckState {
  mode: HealthcheckMode;
  overrideType: HealthcheckOverrideType;
  port: string;
  processName: string;
  command: string;
  intervalSeconds: string;
  timeoutSeconds: string;
  startPeriodSeconds: string;
  retries: string;
}

// 'installing' is intentionally excluded: the container will be recreated at end of install anyway.
const RUNNING_STATUSES = new Set(['running', 'starting', 'stopping', 'restarting', 'unhealthy']);

interface ContainerConfigTabProps {
  serverId?: number | null;
  serverName?: string;
  canDelete?: boolean;
  serverStatus?: string | null;
  borderColor: string;
  contentBg: string;
  inputBg: string;
  inputBorder: string;
  textPrimary: string;
  textSecondary: string;
  hoverBg: string;
  canEdit: boolean;
  isRoot?: boolean;
  canManageEnv: boolean;
  pickerManagedKeys?: string[];
  onSaved?: () => void;
}

function parseField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function envToEntries(raw: unknown): EnvEntry[] {
  const parsed = parseField<any>(raw, {});
  if (Array.isArray(parsed)) {
    // Backend format: ["KEY=VALUE", ...]
    return (parsed as string[]).map((item) => {
      const idx = item.indexOf('=');
      return idx >= 0
        ? { key: item.slice(0, idx), value: item.slice(idx + 1) }
        : { key: item, value: '' };
    });
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return Object.entries(parsed).map(([key, value]) => ({ key, value: String(value) }));
  }
  return [];
}

function entriesToEnv(entries: EnvEntry[]): Record<string, string> {
  return Object.fromEntries(entries.filter(e => e.key.trim()).map(e => [e.key.trim(), e.value]));
}

function parseHealthcheck(raw: unknown): HealthcheckState {
  const defaults: HealthcheckState = {
    mode: 'image_default',
    overrideType: 'tcp_connect',
    port: '',
    processName: '',
    command: '',
    intervalSeconds: '30',
    timeoutSeconds: '10',
    startPeriodSeconds: '60',
    retries: '3',
  };
  const parsed = parseField<any>(raw, null);
  if (!parsed || parsed.mode === 'image_default') return defaults;
  if (parsed.mode === 'disabled') return { ...defaults, mode: 'disabled' };
  if (parsed.mode === 'override') {
    // Backend stores normalized format: { probe: { type, port/name/command }, intervalSeconds, ... }
    // Frontend sends flat format: { type, port/name/command, intervalSeconds, ... }
    const probe = parsed.probe ?? parsed;
    const cmdRaw = probe.command;
    return {
      mode: 'override',
      overrideType: probe.type ?? 'tcp_connect',
      port: String(probe.port ?? ''),
      processName: probe.name ?? '',
      command: Array.isArray(cmdRaw) ? cmdRaw.join(' ') : (cmdRaw ?? ''),
      intervalSeconds: String(parsed.intervalSeconds ?? '30'),
      timeoutSeconds: String(parsed.timeoutSeconds ?? '10'),
      startPeriodSeconds: String(parsed.startPeriodSeconds ?? '60'),
      retries: String(parsed.retries ?? '3'),
    };
  }
  return defaults;
}

function buildHealthcheckPayload(hc: HealthcheckState): { mode: string; [k: string]: unknown } | null {
  if (hc.mode === 'image_default') return { mode: 'image_default' };
  if (hc.mode === 'disabled') return { mode: 'disabled' };
  const base = {
    mode: 'override' as const,
    type: hc.overrideType,
    intervalSeconds: Number(hc.intervalSeconds) || 30,
    timeoutSeconds: Number(hc.timeoutSeconds) || 10,
    startPeriodSeconds: Number(hc.startPeriodSeconds) || 60,
    retries: Number(hc.retries) || 3,
  };
  if (hc.overrideType === 'tcp_connect') return { ...base, port: Number(hc.port) };
  if (hc.overrideType === 'process') return { ...base, name: hc.processName };
  return { ...base, command: hc.command.trim().split(/\s+/).filter(Boolean) };
}

function portsFromRaw(raw: unknown): { tcp: PortEntry[]; udp: PortEntry[] } {
  const parsed = parseField<any>(raw, { tcp: [], udp: [] });
  const toEntries = (arr: any[]): PortEntry[] =>
    (Array.isArray(arr) ? arr : []).map((e: any) => ({
      host: String(e.host ?? ''),
      container: String(e.container ?? ''),
      label: e.label ?? '',
      hostIp: e.hostIp ?? '',
    }));
  return {
    tcp: toEntries(parsed?.tcp ?? []),
    udp: toEntries(parsed?.udp ?? []),
  };
}

function mountsFromRaw(raw: unknown): MountEntry[] {
  const parsed = parseField<any[]>(raw, []);
  return (Array.isArray(parsed) ? parsed : []).map((m: any) => ({
    key: m.key ?? '',
    containerPath: m.containerPath ?? '',
  }));
}

const inputClass =
  'w-full rounded bg-[#1f2937] border border-gray-600 text-white text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--gp-primary-300)] disabled:opacity-50';

const sectionClass = 'space-y-3';

export function ContainerConfigTab({
  serverId,
  serverName,
  canDelete = false,
  serverStatus,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
  canEdit,
  isRoot = false,
  canManageEnv,
  onSaved,
}: ContainerConfigTabProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  const [customParams, setCustomParams] = useState('');
  const [savedCustomParams, setSavedCustomParams] = useState('');
  const [startupText, setStartupText] = useState('');
  const [savedStartupText, setSavedStartupText] = useState('');
  const [editingStartup, setEditingStartup] = useState(false);
  const [portCheck, setPortCheck] = useState<{ signature: string; errors: Record<string, string>; pools: Record<string, number[]> }>();
  const [portRefresh, setPortRefresh] = useState(0);
  const [dockerImage, setDockerImage] = useState('');
  const [nativeSnapshot, setNativeSnapshot] = useState<{ document: GameTemplate; version: number } | null>(null);
  const [tcpPorts, setTcpPorts] = useState<PortEntry[]>([]);
  const [udpPorts, setUdpPorts] = useState<PortEntry[]>([]);
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([]);
  const [mounts, setMounts] = useState<MountEntry[]>([]);
  const [healthcheck, setHealthcheck] = useState<HealthcheckState>(() => parseHealthcheck(null));
  const [cpuLimit, setCpuLimit] = useState('');
  const [memoryLimitMb, setMemoryLimitMb] = useState('');

  const [savedTcpPorts, setSavedTcpPorts] = useState<PortEntry[]>([]);
  const [savedUdpPorts, setSavedUdpPorts] = useState<PortEntry[]>([]);
  const [savedEnvEntries, setSavedEnvEntries] = useState<EnvEntry[]>([]);
  const [savedMounts, setSavedMounts] = useState<MountEntry[]>([]);
  const [savedHealthcheck, setSavedHealthcheck] = useState<HealthcheckState>(() => parseHealthcheck(null));
  const [savedCpuLimit, setSavedCpuLimit] = useState('');
  const [savedMemoryLimitMb, setSavedMemoryLimitMb] = useState('');

  const hasChanges = useMemo(() => (
    customParams !== savedCustomParams || startupText !== savedStartupText ||
    JSON.stringify(tcpPorts) !== JSON.stringify(savedTcpPorts) ||
    JSON.stringify(udpPorts) !== JSON.stringify(savedUdpPorts) ||
    JSON.stringify(envEntries) !== JSON.stringify(savedEnvEntries) ||
    JSON.stringify(mounts) !== JSON.stringify(savedMounts) ||
    JSON.stringify(healthcheck) !== JSON.stringify(savedHealthcheck) ||
    cpuLimit !== savedCpuLimit ||
    memoryLimitMb !== savedMemoryLimitMb
  ), [customParams, savedCustomParams, startupText, savedStartupText, tcpPorts, udpPorts, envEntries, mounts, healthcheck, cpuLimit, memoryLimitMb, savedTcpPorts, savedUdpPorts, savedEnvEntries, savedMounts, savedHealthcheck, savedCpuLimit, savedMemoryLimitMb]);

  const applyLoaded = (raw: any) => {
    const pending = raw?.providerMetadata?.pendingConfiguration;
    setPendingRestart(!!pending);
    if (pending) raw = { ...raw, ...pending, providerMetadata: { ...raw.providerMetadata, ...(pending.hasStartupPatch ? { startupCommand: pending.startupCommand } : {}), ...(pending.hasCustomParamsPatch ? { customParams: pending.customParams } : {}) } };
    const snapshot = raw?.providerMetadata?.template;
    setNativeSnapshot(snapshot?.document?.schemaVersion === 2 ? snapshot : null);
    setDockerImage(raw?.dockerImage ?? '');
    const custom = formatStartup(raw?.providerMetadata?.customParams || []);
    setCustomParams(custom); setSavedCustomParams(custom);
    const game = gameStartup(snapshot?.document?.lifecycle?.startup || []);
    const command = game ? formatStartup(raw?.providerMetadata?.startupCommand || game.command) : '';
    setStartupText(command); setSavedStartupText(command); setEditingStartup(false);
    const ports = portsFromRaw(raw?.ports);
    const env = envToEntries(raw?.env);
    const mnts = mountsFromRaw(raw?.mounts);
    const hc = parseHealthcheck(raw?.healthcheck);
    const rl = raw?.resourceLimits ?? null;
    const cpu = rl?.cpu != null ? String(rl.cpu) : '';
    const mem = rl?.memoryMb != null ? String(rl.memoryMb) : '';
    setTcpPorts(ports.tcp);   setSavedTcpPorts(ports.tcp);
    setUdpPorts(ports.udp);   setSavedUdpPorts(ports.udp);
    setEnvEntries(env);       setSavedEnvEntries(env);
    setMounts(mnts);          setSavedMounts(mnts);
    setHealthcheck(hc);       setSavedHealthcheck(hc);
    setCpuLimit(cpu);         setSavedCpuLimit(cpu);
    setMemoryLimitMb(mem);    setSavedMemoryLimitMb(mem);
  };

  useEffect(() => {
    if (!serverId) return;
    setLoading(true);
    setError(null);

    apiClient
      .getServer(serverId)
      .then(applyLoaded)
      .catch((err: any) => {
        setError(err?.response?.data?.error || err?.message || 'Failed to load server config');
      })
      .finally(() => setLoading(false));
  }, [serverId]);

  const portSignature = JSON.stringify([tcpPorts, udpPorts, portRefresh]);
  const checkPorts = async () => {
    const errors: Record<string, string> = {};
    const pools: Record<string, number[]> = {};
    for (const protocol of ['tcp', 'udp'] as const) {
      const ports = protocol === 'tcp' ? tcpPorts : udpPorts;
      const saved = protocol === 'tcp' ? savedTcpPorts : savedUdpPorts;
      for (let i = 0; i < ports.length; i++) {
        const port = ports[i]; const key = `${protocol}-${i}`;
        const unchanged = saved.some(p => p.host === port.host && p.hostIp === port.hostIp);
        if (!/^\d+$/.test(port.host) || Number(port.host) < 1025 || Number(port.host) > 65535 || !/^\d+$/.test(port.container) || Number(port.container) < 1 || Number(port.container) > 65535) {
          errors[key] = 'Enter a valid port (1025–65535).'; continue;
        }
        if (ports.some((p, j) => j !== i && Number(p.host) === Number(port.host) && (!p.hostIp || !port.hostIp || p.hostIp === '0.0.0.0' || port.hostIp === '0.0.0.0' || p.hostIp === port.hostIp))) {
          errors[key] = 'This port is used by another mapping.'; continue;
        }
        const poolKey = `${port.hostIp}/${protocol}`;
        try {
          if (!pools[poolKey]) {
            const result = await apiClient.getAvailableServerPorts(serverId!, port.hostIp || '0.0.0.0', protocol);
            if (!Array.isArray(result.ports)) throw new Error('Cannot check available ports.');
            pools[poolKey] = result.ports;
          }
          if (!unchanged && !pools[poolKey].includes(Number(port.host))) errors[key] = 'Port unavailable. Choose an available port.';
        } catch { if (!unchanged) errors[key] = 'Cannot check available ports. Retry before saving.'; }
      }
    }
    return { signature: portSignature, errors, pools };
  };
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void checkPorts().then(result => { if (active) setPortCheck(result); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [portSignature, isRoot, savedTcpPorts, savedUdpPorts]);
  const portsReady = portCheck?.signature === portSignature && Object.keys(portCheck.errors).length === 0;
  let startupError = '';
  let startupCommand = '';
  let startupArgv: string[] | undefined;
  let customArgv: string[] = [];
  try {
    if (startupText && nativeSnapshot?.document.lifecycle) {
      startupArgv = parseStartup(startupText);
      customArgv = customParams.trim() ? parseStartup(customParams) : [];
      applyStartupOverride(nativeSnapshot.document.lifecycle.startup, [...startupArgv, ...customArgv], [...nativeSnapshot.document.variables.map(v => v.key), ...nativeSnapshot.document.ports.map(p => p.env)]);
      startupCommand = formatStartup([...startupArgv, ...customArgv].map(arg => arg.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (placeholder, key) => {
        const variable = nativeSnapshot.document.variables.find(v => v.key === key);
        if (variable?.secret || !canManageEnv) return '[hidden]';
        return envEntries.find(e => e.key === key)?.value ?? variable?.default ?? placeholder;
      })));
    }
  } catch (e) { startupError = (e as Error).message; }

  const handleSave = async (applyMode: 'restart' | 'defer' = 'restart') => {
    if (!serverId || !canEdit || startupError) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    const cpuVal = parseFloat(cpuLimit);
    const memVal = parseInt(memoryLimitMb, 10);
    const payload: any = {
      applyMode,
      ports: {
        tcp: tcpPorts
          .filter(p => p.host && p.container)
          .map(p => ({ host: Number(p.host), container: Number(p.container), label: p.label, hostIp: p.hostIp || undefined })),
        udp: udpPorts
          .filter(p => p.host && p.container)
          .map(p => ({ host: Number(p.host), container: Number(p.container), label: p.label, hostIp: p.hostIp || undefined })),
      },
      mounts: mounts.filter(m => m.key && m.containerPath),
      healthcheck: buildHealthcheckPayload(healthcheck),
      resourceLimits: (cpuVal > 0 || memVal > 0) ? { cpu: cpuVal > 0 ? cpuVal : 0, memoryMb: memVal > 0 ? memVal : 0 } : null,
    };

    if (customParams !== savedCustomParams) payload.customParams = customArgv;
    if (startupText !== savedStartupText) payload.startupCommand = startupArgv;
    if (canManageEnv) {
      payload.env = entriesToEnv(envEntries);
    }

    try {
      const checked = await checkPorts();
      setPortCheck(checked);
      if (Object.keys(checked.errors).length) throw new Error(Object.values(checked.errors)[0]);
      await apiClient.updateServer(serverId, payload);
      setSavedCustomParams(customParams);
      setSavedStartupText(startupText);
      setSavedTcpPorts(tcpPorts);
      setSavedUdpPorts(udpPorts);
      setSavedEnvEntries(envEntries);
      setSavedMounts(mounts);
      setSavedHealthcheck(healthcheck);
      setSavedCpuLimit(cpuLimit);
      setSavedMemoryLimitMb(memoryLimitMb);
      setPendingRestart(applyMode === 'defer');
      setSuccess(true);
      onSaved?.();
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const addPort = (protocol: 'tcp' | 'udp') => {
    const entry: PortEntry = { host: '', container: '', label: '', hostIp: savedTcpPorts[0]?.hostIp || savedUdpPorts[0]?.hostIp || '' };
    if (protocol === 'tcp') setTcpPorts(p => [...p, entry]);
    else setUdpPorts(p => [...p, entry]);
  };

  const updatePort = (protocol: 'tcp' | 'udp', idx: number, field: keyof PortEntry, val: string) => {
    const setter = protocol === 'tcp' ? setTcpPorts : setUdpPorts;
    setter(prev => prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));
  };

  const removePort = (protocol: 'tcp' | 'udp', idx: number) => {
    const setter = protocol === 'tcp' ? setTcpPorts : setUdpPorts;
    setter(prev => prev.filter((_, i) => i !== idx));
  };

  const addEnv = () => setEnvEntries(e => [...e, { key: '', value: '' }]);
  const updateEnv = (idx: number, field: keyof EnvEntry, val: string) =>
    setEnvEntries(prev => prev.map((e, i) => (i === idx ? { ...e, [field]: val } : e)));
  const removeEnv = (idx: number) => setEnvEntries(prev => prev.filter((_, i) => i !== idx));

  const addMount = () => setMounts(m => [...m, { key: '', containerPath: '' }]);
  const updateMount = (idx: number, field: keyof MountEntry, val: string) =>
    setMounts(prev => prev.map((m, i) => (i === idx ? { ...m, [field]: val } : m)));
  const removeMount = (idx: number) => setMounts(prev => prev.filter((_, i) => i !== idx));

  const setHc = (patch: Partial<HealthcheckState>) =>
    setHealthcheck(prev => ({ ...prev, ...patch }));

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="gp-server-settings-body gp-settings">
        <div>
          <h3 className={`gp-section-title ${textPrimary} mb-1`}>Settings</h3>

        </div>

        <div className="gp-settings-runtime">
          <section className="gp-settings-card gp-settings-startup">
            <div className="gp-settings-section-head"><h4>Startup command</h4>{startupText && canEdit && canManageEnv && <AppButton tone="ghost" onClick={() => setEditingStartup(v => !v)}>{editingStartup ? 'Close editor' : 'Edit startup parameters'}</AppButton>}</div>
            <pre>{startupCommand || (startupError ? 'Fix the parameters below to preview the command.' : 'Default image entrypoint')}</pre>
            {editingStartup && <div className="gp-settings-startup-editor"><textarea aria-label="Startup parameters" rows={4} spellCheck={false} value={startupText} disabled={saving} onChange={e => setStartupText(e.target.value)} /><div className="gp-startup-variables"><small>Dostępne parametry:</small>{[...new Set([...(nativeSnapshot?.document.variables.map(v => v.key) || []), ...(nativeSnapshot?.document.ports.map(p => p.env).filter(Boolean) || [])])].map(key => <code key={key}>{'{{' + key + '}}'}</code>)}</div>{startupError && <p role="alert" className="gp-settings-port-error">{startupError}</p>}</div>}
          </section>
          <section className="gp-settings-card"><h4>Docker image</h4><code>{dockerImage || '—'}</code></section>
        </div>

        {canManageEnv && (
        <div className="gp-settings-card">
          <h4 className={`text-base font-semibold ${textPrimary} mb-4`}>{nativeSnapshot ? 'Template Variables' : 'Environment Variables'}</h4>
          <div className={nativeSnapshot ? "gp-settings-variables" : sectionClass}>
            {envEntries.length === 0 && (
              <p className={`text-sm ${textSecondary}`}>No variables configured.</p>
            )}
            {envEntries.map((entry, idx) => nativeSnapshot?.document.ports.some(p => p.env === entry.key) ? null : (
              <div key={idx} className={nativeSnapshot ? "gp-settings-variable" : "flex gap-2 items-center"}>
                {nativeSnapshot && <label htmlFor={`setting-env-${idx}`}>{nativeSnapshot.document.variables.find(v => v.key === entry.key)?.label || entry.key}</label>}
                {!nativeSnapshot && <input
                  className={`${inputClass} flex-1`}
                  placeholder="KEY"
                  value={entry.key}
                  onChange={e => updateEnv(idx, 'key', e.target.value)}
                  disabled={saving || !canEdit}
                />}
                {!nativeSnapshot && <span className={`text-sm ${textSecondary} flex-shrink-0`}>=</span>}
                <input
                  id={`setting-env-${idx}`}
                  className={`${inputClass} flex-[2]`}
                  placeholder="value"
                  aria-label={nativeSnapshot?.document.variables.find(v => v.key === entry.key)?.label || entry.key}
                  type={nativeSnapshot?.document.variables.find(v => v.key === entry.key)?.secret ? 'password' : 'text'}
                  value={entry.value}
                  onChange={e => updateEnv(idx, 'value', e.target.value)}
                  disabled={saving || !canEdit || !!nativeSnapshot?.document.ports.some(p => p.env === entry.key)}
                />
                {nativeSnapshot && startupText && <div className="gp-settings-variable"><label htmlFor="custom-startup-params">Custom params</label><input id="custom-startup-params" className={inputClass} placeholder="e.g. -tickrate 128 +sv_lan 0" value={customParams} disabled={saving || !canEdit} onChange={e => setCustomParams(e.target.value)} /><small className="text-xs text-slate-400">Appended to the startup command.</small>{startupError && !editingStartup && <p role="alert" className="gp-settings-port-error">{startupError}</p>}</div>}
            {canEdit && !nativeSnapshot && (
                  <AppButton
                    tone="ghost"
                    onClick={() => removeEnv(idx)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700 flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </AppButton>
                )}
              </div>
            ))}
            {canEdit && !nativeSnapshot && (
              <AppButton
                tone="ghost"
                onClick={addEnv}
                className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border border-dashed ${borderColor} text-gray-400 hover:text-white hover:bg-gray-700 transition-colors`}
              >
                <Plus className="w-4 h-4" />
                Add variable
              </AppButton>
            )}
          </div>
        </div>
        )}

        <div className="gp-settings-card">
          <div className="gp-settings-section-head"><h4>Ports</h4><AppButton tone="ghost" onClick={() => setPortRefresh(n => n + 1)} aria-label="Refresh available ports"><RefreshCw size={16} /></AppButton></div>

          <div className="space-y-5">
            <PortsSection
              label="TCP"
              ports={tcpPorts}
              errors={portCheck?.signature === portSignature ? portCheck.errors : {}} pools={portCheck?.pools || {}} checking={portCheck?.signature !== portSignature}
              protocol="tcp"
              lockedStructure={!!nativeSnapshot}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              canEdit={canEdit && !saving}
              onAdd={() => addPort('tcp')}
              onUpdate={(idx, field, val) => updatePort('tcp', idx, field, val)}
              onRemove={idx => removePort('tcp', idx)}
            />
            <PortsSection
              label="UDP"
              ports={udpPorts}
              errors={portCheck?.signature === portSignature ? portCheck.errors : {}} pools={portCheck?.pools || {}} checking={portCheck?.signature !== portSignature}
              protocol="udp"
              lockedStructure={!!nativeSnapshot}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              canEdit={canEdit && !saving}
              onAdd={() => addPort('udp')}
              onUpdate={(idx, field, val) => updatePort('udp', idx, field, val)}
              onRemove={idx => removePort('udp', idx)}
            />
          </div>
        </div>

        <div className="gp-settings-card">
          <h4 className={`text-base font-semibold ${textPrimary} mb-1`}>Resources &amp; Volumes</h4>
          <p className={`text-xs ${textSecondary} mb-4`}>
            Leave blank for unlimited resources.
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`w-28 flex-shrink-0 text-sm ${textSecondary}`}>vCPU</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className={`${inputClass} flex-1`}
                placeholder="e.g. 2"
                value={cpuLimit}
                onChange={e => setCpuLimit(e.target.value)}
                disabled={saving || !canEdit}
              />
              {canEdit && cpuLimit && (
                <AppButton
                  tone="ghost"
                  onClick={() => setCpuLimit('')}
                  className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                  title="Remove CPU limit"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </AppButton>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-28 flex-shrink-0 text-sm ${textSecondary}`}>RAM (MB)</span>
              <input
                type="number"
                min="0"
                step="128"
                className={`${inputClass} flex-1`}
                placeholder="e.g. 4096"
                value={memoryLimitMb}
                onChange={e => setMemoryLimitMb(e.target.value)}
                disabled={saving || !canEdit}
              />
              {memoryLimitMb && !isNaN(Number(memoryLimitMb)) && Number(memoryLimitMb) > 0 && (
                <span className={`text-xs flex-shrink-0 ${textSecondary}`}>≈ {(Number(memoryLimitMb) / 1024).toFixed(1)} GB</span>
              )}
              {canEdit && memoryLimitMb && (
                <AppButton
                  tone="ghost"
                  onClick={() => setMemoryLimitMb('')}
                  className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                  title="Remove RAM limit"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </AppButton>
              )}
            </div>
          </div>
        <div className="gp-settings-volumes">          <h4 className={`text-base font-semibold ${textPrimary} mb-4`}>Volumes</h4>
          <div className={sectionClass}>
            {mounts.length === 0 && (
              <p className={`text-sm ${textSecondary}`}>No mounts configured.</p>
            )}
            {mounts.length > 0 && (
              <div className="flex gap-2 items-center">
                <span className={`flex-1 text-xs font-medium ${textSecondary}`}>Name</span>
                <span className="text-sm flex-shrink-0 invisible">→</span>
                <span className={`flex-[2] text-xs font-medium ${textSecondary}`}>Container path</span>
                {canEdit && (
                  <span className="p-1.5 flex-shrink-0 invisible" aria-hidden><Trash2 className="w-4 h-4" /></span>
                )}
              </div>
            )}
            {mounts.map((mount, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  className={`${inputClass} flex-1`}
                  placeholder="key (e.g. data)"
                  value={mount.key}
                  onChange={e => updateMount(idx, 'key', e.target.value)}
                  disabled={saving || !canEdit || !!nativeSnapshot}
                />
                <span className={`text-sm ${textSecondary} flex-shrink-0`}>→</span>
                <input
                  className={`${inputClass} flex-[2]`}
                  placeholder="containerPath (e.g. /data)"
                  value={mount.containerPath}
                  onChange={e => updateMount(idx, 'containerPath', e.target.value)}
                  disabled={saving || !canEdit || !!nativeSnapshot}
                />
                {canEdit && !nativeSnapshot && (
                  <AppButton
                    tone="ghost"
                    onClick={() => removeMount(idx)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700 flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </AppButton>
                )}
              </div>
            ))}
            {canEdit && !nativeSnapshot && (
              <AppButton
                tone="ghost"
                onClick={addMount}
                className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border border-dashed ${borderColor} text-gray-400 hover:text-white hover:bg-gray-700 transition-colors`}
              >
                <Plus className="w-4 h-4" />
                Add volume
              </AppButton>
            )}
          </div>
</div>
        </div>

        <details className="gp-settings-advanced"><summary>Advanced settings <span>Healthcheck &amp; maintenance</span></summary><div className="gp-settings-advanced-body">
          <h4 className={`text-base font-semibold ${textPrimary} mb-4`}>Healthcheck</h4>
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-600 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Use the image default unless a custom healthcheck is required.</span>
            </div>
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Mode</label>
              <select
                className={`${inputClass}`}
                value={healthcheck.mode}
                onChange={e => setHc({ mode: e.target.value as HealthcheckMode })}
                disabled={saving || !canEdit}
              >
                <option value="image_default">Image default</option>
                <option value="disabled">Disabled</option>
                <option value="override">Override</option>
              </select>
            </div>

            {healthcheck.mode === 'override' && (
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>Type</label>
                  <select
                    className={`${inputClass}`}
                    value={healthcheck.overrideType}
                    onChange={e => setHc({ overrideType: e.target.value as HealthcheckOverrideType })}
                    disabled={saving || !canEdit}
                  >
                    <option value="tcp_connect">TCP connect</option>
                    <option value="process">Process</option>
                    <option value="command">Command</option>
                  </select>
                </div>

                {healthcheck.overrideType === 'tcp_connect' && (
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Port</label>
                    <input
                      type="number"
                      className={inputClass}
                      placeholder="e.g. 25565"
                      value={healthcheck.port}
                      onChange={e => setHc({ port: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                )}

                {healthcheck.overrideType === 'process' && (
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Process name</label>
                    <input
                      className={inputClass}
                      placeholder="e.g. srcds"
                      value={healthcheck.processName}
                      onChange={e => setHc({ processName: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                )}

                {healthcheck.overrideType === 'command' && (
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Command (space-separated args)</label>
                    <input
                      className={inputClass}
                      placeholder='e.g. curl -f http://localhost:8080/health'
                      value={healthcheck.command}
                      onChange={e => setHc({ command: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Interval (s)</label>
                    <input
                      type="number"
                      className={inputClass}
                      value={healthcheck.intervalSeconds}
                      onChange={e => setHc({ intervalSeconds: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Timeout (s)</label>
                    <input
                      type="number"
                      className={inputClass}
                      value={healthcheck.timeoutSeconds}
                      onChange={e => setHc({ timeoutSeconds: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Start period (s)</label>
                    <input
                      type="number"
                      className={inputClass}
                      value={healthcheck.startPeriodSeconds}
                      onChange={e => setHc({ startPeriodSeconds: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>Retries</label>
                    <input
                      type="number"
                      className={inputClass}
                      value={healthcheck.retries}
                      onChange={e => setHc({ retries: e.target.value })}
                      disabled={saving || !canEdit}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        {nativeSnapshot && serverId && <NativeRuntimeCard template={nativeSnapshot.document} version={nativeSnapshot.version} serverId={serverId} status={serverStatus} isRoot={isRoot} />}
        </div></details>
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/30 rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-green-400 bg-green-400/10 border border-green-400/30 rounded-lg px-4 py-3">
            {pendingRestart ? 'Saved. Changes apply on the next start or restart from the panel.' : 'Settings saved.'}
          </div>
        )}
        {pendingRestart && !success && <p role="status" className="text-sm text-slate-400">Saved changes will apply on the next start or restart from the panel.</p>}
        {canEdit && (
          <div className="flex justify-end pb-4">
            <AppButton
              tone="primary"
              onClick={() => RUNNING_STATUSES.has(serverStatus ?? '') ? setShowRestartConfirm(true) : void handleSave()}
              disabled={saving || !hasChanges || !portsReady || !!startupError}
              className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save changes'}
            </AppButton>
          </div>
        )}
        {canDelete && serverId && serverName && <DeleteServerSection serverId={serverId} serverName={serverName} />}
      </div>

      {showRestartConfirm && (
        <WorkspaceModalOverlay>
          <div role="dialog" aria-modal="true" aria-label="Save changes" className={`${contentBg} border ${borderColor} w-full max-w-xl rounded-xl shadow-2xl`}>
            <div className={`flex items-center justify-between border-b ${borderColor} px-6 py-4`}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
                  <RefreshCw className="h-4 w-4 text-amber-500" />
                </div>
                <h3 className={`text-base font-semibold ${textPrimary}`}>Save changes</h3>
              </div>
              <AppButton
                onClick={() => setShowRestartConfirm(false)}
                className={`rounded-md p-1.5 transition-colors ${textSecondary} hover:bg-gray-100 dark:hover:bg-white/10`}
              >
                <X className="h-4 w-4" />
              </AppButton>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className={`text-sm ${textSecondary}`}>Save for the next restart, or apply now and restart the server.</p>
            </div>

            <div className={`flex flex-wrap justify-end gap-3 border-t ${borderColor} px-6 py-4`}>
              <AppButton
                onClick={() => setShowRestartConfirm(false)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${textSecondary} hover:bg-gray-100 dark:hover:bg-white/10`}
              >
                Cancel
              </AppButton>
              <AppButton tone="secondary" disabled={saving} onClick={() => { setShowRestartConfirm(false); void handleSave('defer'); }}>
                Save without restart
              </AppButton>
              <AppButton
                onClick={() => { setShowRestartConfirm(false); void handleSave(); }}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Confirm &amp; restart
              </AppButton>
            </div>
          </div>
        </WorkspaceModalOverlay>
      )}
    </div>
  );
}

interface PortsSectionProps {
  lockedStructure?: boolean; label: string; ports: PortEntry[]; protocol: 'tcp' | 'udp';
  textPrimary: string; textSecondary: string; canEdit: boolean;
  errors: Record<string, string>; pools: Record<string, number[]>; checking: boolean;
  onAdd: () => void; onUpdate: (idx: number, field: keyof PortEntry, val: string) => void; onRemove: (idx: number) => void;
}
function PortsSection({ lockedStructure, label, ports, protocol, canEdit, errors, pools, checking, onAdd, onUpdate, onRemove }: PortsSectionProps) {
  if (!ports.length && lockedStructure) return null;
  return <div className="gp-settings-ports">
    {ports.map((port, idx) => {
      const error = errors[`${protocol}-${idx}`];
      const listId = `ports-${protocol}-${idx}`;
      return <div key={idx} className="gp-settings-port">
        <div className="gp-settings-address"><span className="gp-settings-protocol">{label}</span><span>IP address</span><code>{port.hostIp || '0.0.0.0'}</code></div>
        <label>Public port<input type="number" min="1025" max="65535" list={listId} className={inputClass} aria-label={`${label} public port ${idx + 1}`} aria-invalid={!!error} value={port.host} disabled={!canEdit} onChange={e => onUpdate(idx, 'host', e.target.value)} />
          <datalist id={listId}>{(pools[`${port.hostIp}/${protocol}`] || []).slice(0, 256).map(p => <option key={p} value={p} />)}</datalist>
        </label>
        <label>Container port<input type="number" min="1" max="65535" className={inputClass} value={port.container} disabled={!canEdit || lockedStructure} onChange={e => onUpdate(idx, 'container', e.target.value)} /></label>
        <label className="gp-settings-port-name">Name<input className={inputClass} value={port.label} disabled={!canEdit} onChange={e => onUpdate(idx, 'label', e.target.value)} /></label>
        {canEdit && !lockedStructure && <AppButton tone="ghost" aria-label={`Remove ${label} port ${idx + 1}`} onClick={() => onRemove(idx)}><Trash2 size={16} /></AppButton>}
        {(checking || error) && <p className={error ? 'gp-settings-port-error' : 'gp-settings-port-check'} role="status">{error || 'Checking ports…'}</p>}
      </div>;
    })}
    {canEdit && !lockedStructure && <AppButton tone="ghost" onClick={onAdd}><Plus size={16} /> Add {label} port</AppButton>}
  </div>;
}
