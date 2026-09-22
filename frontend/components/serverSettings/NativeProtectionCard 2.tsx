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
  return <AppCard className="p-4 sm:p-5" role="region" aria-label="Data protection">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h4 className="font-semibold">Data protection</h4>
      {supported && <AppButton disabled={loading} onClick={() => setRequest(value => value + 1)}>{loading ? 'Measuring…' : 'Refresh protection summary'}</AppButton>}
    </div>
    {!supported && <p className="text-sm text-gray-500 dark:text-gray-400">{checking ? 'Checking agent support…' : 'Update this node’s agent to display protection records and storage measurements.'}</p>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {summary && <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          ['Game files · allocated', summary.gameAllocatedBytes],
          ['Archive files', summary.archiveBytes],
          ['Recovery · allocated', summary.recoveryAllocatedBytes],
          ['Node free space', summary.nodeFreeBytes],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt><dd className="font-semibold mt-1">{resourceBytes(value)}</dd></div>)}
      </dl>
      <p className="text-xs text-gray-500 dark:text-gray-400">Measured {date(summary.measuredAt)}. Refresh after an operation. Recovery directories: {summary.recoveryCount ?? 'unknown'}.</p>
      <div>
        <p className="font-medium">Latest recorded available backup</p>
        {summary.latestBackup ? <>
          <p className="break-all">{summary.latestBackup.name}</p>
          <p>{summary.latestBackup.mode === 'live' ? 'Live · game consistency not guaranteed' : 'Offline'} · {date(summary.latestBackup.createdAt)}</p>
          <p className="text-gray-500 dark:text-gray-400">Archive structure checked {date(summary.latestBackup.validatedAt)}. This is not a restore test or a game startup test.</p>
        </> : <p>No matching backup record. Existing archives are not assumed to be verified.</p>}
        {summary.unverifiedCount !== null && summary.unverifiedCount > 0 && <p>{summary.unverifiedCount} archive(s) without a matching validation record.</p>}
      </div>
      <div>
        <p className="font-medium">Backup schedule</p>
        <p>{!summary.schedules ? 'Schedule status unavailable.' : summary.schedules.enabled === 0 ? 'No enabled backup schedule.' : `${summary.schedules.enabled} enabled · next run: ${date(summary.schedules.nextRunAt)}`}</p>
        {Boolean(summary.schedules?.lastProblem) && <p className="text-amber-600 dark:text-amber-400">{summary.schedules!.lastProblem} enabled schedule(s) last failed or were skipped. Review Schedules.</p>}
      </div>
      <div>
        <p className="font-medium">Latest recorded restore attempt</p>
        <p>{!summary.restoreHistoryAvailable ? 'Restore history unavailable.' : summary.lastRestore ? `${summary.lastRestore.status} · ${date(summary.lastRestore.completedAt || summary.lastRestore.startedAt)}` : 'No restore attempt in the recent operation history.'}</p>
        <p className="text-gray-500 dark:text-gray-400">History includes up to 100 recent operations. A completed restore confirms file replacement, not game startup.</p>
      </div>
      {summary.warnings.map(warning => <p key={warning} role="alert" className="text-amber-600 dark:text-amber-400">{warning}</p>)}
    </div>}
  </AppCard>;
}
