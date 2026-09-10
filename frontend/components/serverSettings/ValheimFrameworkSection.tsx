import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Terminal } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { mapBackendStatusToUi } from '../../utils/serverRuntime';

interface ScriptResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ValheimFrameworkSectionProps {
  serverId: number;
  serverStatus?: string | null;
  canWrite: boolean;
  onInstalledChange?: (installed: boolean) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

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
        {result.ok ? 'Done' : `Failed (exit code ${result.exitCode})`}
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

export function ValheimFrameworkSection({
  serverId,
  serverStatus,
  canWrite,
  onInstalledChange,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: ValheimFrameworkSectionProps) {
  const FRAMEWORK_BLOCKED_STATUSES = ['creating', 'installing', 'starting', 'running', 'stopping', 'restarting'];
  const isStopped = !FRAMEWORK_BLOCKED_STATUSES.includes(mapBackendStatusToUi(serverStatus));

  const [installed, setInstalled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState('');

  const loaded = useRef(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotReady(false);
    try {
      const data = await apiClient.getValheimFrameworks(serverId);
      const value = Boolean(data?.bepinex?.installed);
      setInstalled(value);
      onInstalledChange?.(value);
    } catch (err: any) {
      // The route needs a container: it answers 400 until the install has created one.
      if (err?.response?.status === 400) setNotReady(true);
      else setLoadError(err?.response?.data?.error || err?.message || 'Failed to load mod loader status.');
    } finally {
      setLoading(false);
    }
  }, [serverId, onInstalledChange]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void loadStatus();
  }, [loadStatus]);

  const install = async () => {
    if (!canWrite || installing) return;
    setInstalling(true);
    setError(null);
    setResult(null);
    try {
      const trimmed = version.trim();
      const res = await apiClient.installValheimBepInEx(serverId, trimmed ? { version: trimmed } : undefined);
      setResult(res);
      if (res.ok) await loadStatus();
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        status === 409
          ? `The server must be stopped to ${installed ? 'update' : 'install'} BepInEx.`
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
        Checking mod loader status…
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

  if (notReady) {
    return (
      <div className={`${contentBg} border ${borderColor} rounded-lg p-4 text-sm ${textSecondary}`}>
        The server is still being created. The mod loader can be installed once it exists.
      </div>
    );
  }

  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 sm:p-5`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <h4 className={`text-sm font-semibold ${textPrimary}`}>BepInEx</h4>
          <p className={`text-xs ${textSecondary}`}>
            The mod loader for Valheim. Installing BepInEx lets you load and manage mods that extend your server.
            Mods usually have to be installed on the players’ clients too.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                installed
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-gray-500/10 text-gray-400 border border-gray-600/40'
              }`}
            >
              {installed ? (
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
              <input
                className={versionInputCls}
                value={version}
                disabled={installing}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="latest"
              />
            </div>
            <AppButton
              tone="secondary"
              onClick={() => void install()}
              disabled={installing || !isStopped}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 whitespace-nowrap"
            >
              {installing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {installed ? 'Update BepInEx' : 'Install BepInEx'}
            </AppButton>
          </div>
        )}
      </div>
      {canWrite && !isStopped && (
        <div className="mt-3 flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          The server must be stopped to {installed ? 'update' : 'install'} BepInEx.
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      <LogOutput result={result} />
      {result?.ok && (
        <p className={`mt-2 text-xs ${textSecondary}`}>
          Start the server to load the mod loader — the panel does not restart it for you.
        </p>
      )}
    </div>
  );
}
