import { AppOptionSelect } from '../../src/ui/components/AppOptionSelect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Terminal } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { fetchOxideVersions, type FrameworkVersion } from '../../utils/frameworkCatalog';
import { mapBackendStatusToUi } from '../../utils/serverRuntime';

interface ScriptResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  restarted: boolean;
}

export interface RustFrameworkSectionProps {
  serverId: number;
  serverStatus?: string | null;
  canWrite: boolean;
  onInstalledChange?: (installed: boolean) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type VersionLoadStatus = 'loading' | 'loaded' | 'failed';

const selectCls =
  'w-full rounded-lg bg-white dark:bg-[#0f1723]/60 border border-gray-300 dark:border-gray-700/50 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--gp-ods-accent-primary)] dark:focus:ring-white/20 focus:border-transparent disabled:opacity-50 transition-all appearance-none cursor-pointer';

const versionInputCls =
  'w-full rounded-lg bg-white dark:bg-[#0f1723]/60 border border-gray-300 dark:border-gray-700/50 text-gray-900 dark:text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--gp-ods-accent-primary)] dark:focus:ring-white/20 focus:border-transparent disabled:opacity-50 transition-all';

function LogOutput({ result }: { result: ScriptResult | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!result) return null;
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return (
    <div className="mt-3 space-y-1.5">
      <div className={`flex items-center gap-2 text-xs font-medium ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
        {result.ok ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        {result.ok
          ? `Done${result.restarted ? ' — server restarted' : ''}`
          : `Failed (exit code ${result.exitCode})`}
      </div>
      {combined && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-300 transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Terminal className="w-3 h-3" />
            {expanded ? 'Hide output' : 'Show output'}
          </button>
          {expanded && (
            <pre className="text-[11px] font-mono bg-gray-950 border border-gray-700/60 rounded-lg p-3 max-h-48 overflow-auto text-gray-300 whitespace-pre-wrap break-all">
              {combined}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

export function RustFrameworkSection({
  serverId,
  serverStatus,
  canWrite,
  onInstalledChange,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: RustFrameworkSectionProps) {
  const FRAMEWORK_BLOCKED_STATUSES = ['creating', 'installing', 'starting', 'running', 'stopping', 'restarting'];
  const isStopped = !FRAMEWORK_BLOCKED_STATUSES.includes(mapBackendStatusToUi(serverStatus));

  const [oxideInstalled, setOxideInstalled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [versions, setVersions] = useState<FrameworkVersion[]>([]);
  const [versionsStatus, setVersionsStatus] = useState<VersionLoadStatus>('loading');
  const [version, setVersion] = useState('');

  const loaded = useRef(false);
  const versionsLoaded = useRef(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiClient.getRustFrameworks(serverId);
      const installed = Boolean(data?.frameworks?.oxideInstalled);
      setOxideInstalled(installed);
      onInstalledChange?.(installed);
    } catch (err: any) {
      setLoadError(err?.response?.data?.error || err?.message || 'Failed to load framework status.');
    } finally {
      setLoading(false);
    }
  }, [serverId, onInstalledChange]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (versionsLoaded.current) return;
    versionsLoaded.current = true;
    let cancelled = false;
    void (async () => {
      const oxide = await fetchOxideVersions();
      if (cancelled) return;
      if (oxide && oxide.length > 0) {
        setVersions(oxide);
        setVersion(oxide[0].version);
        setVersionsStatus('loaded');
      } else {
        // Backend defaults to "latest" when no version is supplied.
        setVersionsStatus('failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const install = async () => {
    if (!canWrite || installing) return;
    setInstalling(true);
    setError(null);
    setResult(null);
    try {
      const trimmed = version.trim();
      const res = await apiClient.installRustOxide(serverId, trimmed ? { version: trimmed } : undefined);
      setResult(res);
      if (res.ok) await loadStatus();
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        status === 409
          ? `The server must be stopped to ${oxideInstalled ? 'update' : 'install'} Oxide.`
          : err?.response?.data?.error || err?.message || 'Installation failed.',
      );
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 gap-2 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking framework status…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        {loadError}
      </div>
    );
  }

  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 sm:p-5`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <h4 className={`text-sm font-semibold ${textPrimary}`}>Oxide (uMod)</h4>
          <p className={`text-xs ${textSecondary}`}>
            The modding framework for Rust. Installing Oxide lets you load and manage plugins that extend your server.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                oxideInstalled
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-gray-500/10 text-gray-400 border border-gray-600/40'
              }`}
            >
              {oxideInstalled ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="w-3 h-3 rounded-full border border-current opacity-50 inline-block" />
              )}
              Installed
            </span>
          </div>
        </div>
        {canWrite && (
          <div className="shrink-0 flex flex-col gap-2 w-full sm:w-56">
            <div className="w-full">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Version</label>
              {versionsStatus === 'loading' && (
                <div className="h-9 rounded-lg bg-gray-200 dark:bg-gray-700/50 animate-pulse" />
              )}
              {versionsStatus === 'failed' && (
                <input
                  className={versionInputCls}
                  value={version}
                  disabled={installing}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="latest"
                />
              )}
              {versionsStatus === 'loaded' && (
                <div className="relative">
                  <AppOptionSelect
                    className={selectCls}
                    value={version}
                    disabled={installing}
                    onChange={(selectedValue) => setVersion(selectedValue)}
                  >
                    {versions.map((v, i) => (
                      <option key={v.version} value={v.version}>
                        {v.version}{i === 0 ? ' (Latest)' : ''}{v.type === 'pre-release' ? ' [pre-release]' : ''}
                      </option>
                    ))}
                  </AppOptionSelect>
                </div>
              )}
            </div>
            <AppButton
              tone="secondary"
              onClick={() => void install()}
              disabled={installing || !isStopped}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 whitespace-nowrap"
            >
              {installing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {oxideInstalled ? 'Update Oxide' : 'Install Oxide'}
            </AppButton>
          </div>
        )}
      </div>
      {canWrite && !isStopped && (
        <div className="mt-3 flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          The server must be stopped to {oxideInstalled ? 'update' : 'install'} Oxide.
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <LogOutput result={result} />
    </div>
  );
}
