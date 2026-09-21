import { useEffect, useState } from 'react';
import { AppButton, AppCard } from '../../src/ui/components';
import { apiClient, type NativeProtectionSummary } from '../../utils/api';
import { resourceBytes } from '../../utils/resourceMetrics';
import { apiErrorMessage } from '../../utils/apiError';
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
export function NativeProtectionCard({ serverId, supported, checking }: { serverId: number; supported: boolean; checking: boolean }) {
  const [summary, setSummary] = useState<NativeProtectionSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    let active = true;
    setSummary(null); setError('');
    if (!supported) { setLoading(false); return; }
    setLoading(true);
    void apiClient.nativeProtection(serverId).then(result => { if (active) setSummary(result); })
      .catch(cause => { if (active) setError(apiErrorMessage(cause, 'Unable to inspect data protection.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [serverId, supported, request]);
  return <details className="rounded-xl border border-gray-200 dark:border-gray-700 p-4"><summary className="cursor-pointer font-medium">Storage & backup details</summary><AppCard className="mt-3 p-0 border-0 shadow-none" role="region" aria-label="Data protection">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h4 className="font-semibold">Storage</h4>
      {supported && <AppButton disabled={loading} onClick={() => setRequest(value => value + 1)}>{loading ? 'Measuring…' : 'Refresh storage'}</AppButton>}
    </div>
    {!supported && <p className="text-sm text-gray-500 dark:text-gray-400">{checking ? 'Checking agent support…' : 'Update this node’s agent to display protection records and storage measurements.'}</p>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {summary && <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          ['Game files', summary.gameAllocatedBytes],
          ['Backups', summary.archiveBytes],
          ['Recovery copies', summary.recoveryAllocatedBytes],
          ['Node free space', summary.nodeFreeBytes],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt><dd className="font-semibold mt-1">{resourceBytes(value)}</dd></div>)}
      </dl>
      <p className="text-xs text-gray-500 dark:text-gray-400">Measured {date(summary.measuredAt)} · {summary.recoveryCount ?? '—'} recovery copies</p>
      <div>
        <p className="font-medium">Latest backup</p>
        {summary.latestBackup ? <>
          <p className="break-all">{summary.latestBackup.name}</p>
          <p>{summary.latestBackup.mode === 'live' ? 'Live' : 'Offline'} · {date(summary.latestBackup.createdAt)}</p>
          <p className="text-gray-500 dark:text-gray-400">Structure checked {date(summary.latestBackup.validatedAt)}.</p>
        </> : <p>No verified backup recorded.</p>}
        {summary.unverifiedCount !== null && summary.unverifiedCount > 0 && <p>{summary.unverifiedCount} archive(s) without a matching validation record.</p>}
      </div>
      <div>
        <p className="font-medium">Backup schedule</p>
        <p>{!summary.schedules ? 'Schedule status unavailable.' : summary.schedules.enabled === 0 ? 'No enabled backup schedule.' : `${summary.schedules.enabled} enabled · next run: ${date(summary.schedules.nextRunAt)}`}</p>
        {Boolean(summary.schedules?.lastProblem) && <p className="text-amber-600 dark:text-amber-400">{summary.schedules!.lastProblem} enabled schedule(s) last failed or were skipped. Review Schedules.</p>}
      </div>
      <div>
        <p className="font-medium">Latest restore</p>
        <p>{!summary.restoreHistoryAvailable ? 'Restore history unavailable.' : summary.lastRestore ? `${summary.lastRestore.status} · ${date(summary.lastRestore.completedAt || summary.lastRestore.startedAt)}` : 'No restore recorded.'}</p>
      </div>
      {summary.warnings.map(warning => <p key={warning} role="alert" className="text-amber-600 dark:text-amber-400">{warning}</p>)}
    </div>}
  </AppCard></details>;
}
