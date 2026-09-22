import { useEffect, useId, useState } from 'react';
import { Archive, DownloadCloud, RefreshCw, Save } from 'lucide-react';
import { AppButton, AppInput, AppToggle } from '../../src/ui/components';
import { apiClient, type NativeBackupPolicy, type ExternalBackup } from '../../utils/api';
import { apiErrorMessage } from '../../utils/apiError';
import { resourceBytes } from '../../utils/resourceMetrics';

export function NativeBackupPolicyCard({ serverId, canEdit, canImport, busy, localNames, onImported }: {
  serverId: number; canEdit: boolean; canImport: boolean; busy: boolean; localNames: string[]; onImported: () => void;
}) {
  const id = useId();
  const [policy, setPolicy] = useState<NativeBackupPolicy>();
  const [saved, setSaved] = useState<NativeBackupPolicy>();
  const [destination, setDestination] = useState<{ configured: boolean; label: string | null }>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [copies, setCopies] = useState<ExternalBackup[] | null>(null);
  const [copyError, setCopyError] = useState('');
  const [copyPending, setCopyPending] = useState(false);
  const [importing, setImporting] = useState('');
  useEffect(() => {
    let active = true;
    setPolicy(undefined); setError(''); setNotice(''); setCopies(null);
    void apiClient.nativeBackupPolicy(serverId).then(result => {
      if (active) { setPolicy(result.policy); setSaved(result.policy); setDestination(result.destination); }
    }).catch(e => { if (active) setError(apiErrorMessage(e, 'Unable to read backup settings.')); });
    return () => { active = false; };
  }, [serverId, reload]);
  const save = async () => {
    if (!policy || pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      const result = await apiClient.saveNativeBackupPolicy(serverId, policy);
      setPolicy(result.policy); setSaved(result.policy); setDestination(result.destination);
      setNotice('Settings saved. They apply after the next successful backup.');
    } catch (e) { setError(apiErrorMessage(e, 'Unable to save backup settings. Reload before retrying.')); }
    finally { setPending(false); }
  };
  const list = async () => {
    setCopyPending(true); setCopyError('');
    try { setCopies(await apiClient.externalBackups(serverId)); }
    catch (e) { setCopies(null); setCopyError(apiErrorMessage(e, 'External storage is unavailable.')); }
    finally { setCopyPending(false); }
  };
  const retrieve = async (name: string) => {
    setImporting(name); setCopyError(''); setNotice('');
    try { await apiClient.importExternalBackup(serverId, name); setNotice('Copy imported and checked. Use Restore in the local backup list when the game is stopped.'); }
    catch (e) { setCopyError(apiErrorMessage(e, 'Import could not be confirmed. Check Backup operations before retrying.')); }
    finally { setImporting(''); onImported(); }
  };
  const disabled = !canEdit || busy || pending || Boolean(importing);
  const inputClass = 'w-full min-h-11 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50';
  const valid = policy && [policy.keepLocal, policy.keepExternal].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 100);
  return <section aria-label="Backup protection settings" className="rounded-xl border border-slate-400/20 p-5 sm:p-6 space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3"><Archive size={20} className="text-cyan-500" /><h4 className="font-semibold">Backup protection</h4></div>
      <AppButton aria-label="Reload backup settings" disabled={pending} onClick={() => setReload(n => n + 1)}><RefreshCw size={16} /></AppButton>
    </div>
    {!policy && !error && <p role="status" className="text-sm text-slate-500">Loading backup settings…</p>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {policy && <>
      <p className="text-sm text-slate-500 dark:text-slate-400">Applies to manual and scheduled backups. Set the backup time in Schedules.</p>
      <div className="space-y-2">
        <AppToggle label="Automatic retention" checked={policy.automaticRetention} disabled={disabled} onChange={automaticRetention => setPolicy({ ...policy, automaticRetention })} />
        <p className="text-xs text-slate-500 dark:text-slate-400">Removes older validated backups after a successful new copy. Recovery folders and unrecognized archives stay available for manual cleanup.</p>
      </div>
      <div className="space-y-2">
        <AppToggle label="Copy to external storage" checked={policy.externalCopy} disabled={disabled || (!destination?.configured && !policy.externalCopy)} onChange={externalCopy => setPolicy({ ...policy, externalCopy })} />
        <p className="text-xs text-slate-500 dark:text-slate-400">{destination?.configured ? `Destination: ${destination.label}. Copies are verified before local retention runs.` : 'An administrator must configure external storage on this node.'}</p>
      </div>
      {policy.automaticRetention && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label htmlFor={`${id}-local`} className="block text-sm mb-2">Local backups to keep</label><AppInput className={inputClass} id={`${id}-local`} type="number" min={1} max={100} value={policy.keepLocal} disabled={disabled} onChange={e => setPolicy({ ...policy, keepLocal: Number(e.target.value) })} /></div>
        {policy.externalCopy && <div><label htmlFor={`${id}-external`} className="block text-sm mb-2">External backups to keep</label><AppInput className={inputClass} id={`${id}-external`} type="number" min={1} max={100} value={policy.keepExternal} disabled={disabled} onChange={e => setPolicy({ ...policy, keepExternal: Number(e.target.value) })} /></div>}
      </div>}
      {!canEdit && <p className="text-xs text-slate-500">Editing protection requires backup settings and deletion permissions.</p>}
      {canEdit && <AppButton className="px-4 py-2.5" tone="primary" disabled={disabled || !valid || JSON.stringify(policy) === JSON.stringify(saved)} onClick={() => void save()}><Save size={16} className="mr-2" />{pending ? 'Saving…' : 'Save protection settings'}</AppButton>}
    </>}
    {notice && <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
    {destination?.configured && <div className="border-t border-slate-400/20 pt-5 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3"><h5 className="font-medium">External copies</h5><AppButton disabled={copyPending || Boolean(importing)} onClick={() => void list()}>{copyPending ? 'Checking storage…' : 'Show / refresh copies'}</AppButton></div>
      {copyError && <p role="alert" className="text-sm text-red-500">{copyError}</p>}
      {copies?.length === 0 && <p className="text-sm text-slate-500">No completed external copies found.</p>}
      {copies && copies.length > 0 && <div className="max-h-80 overflow-auto space-y-3">{copies.map(copy => <div key={copy.name} className="rounded-lg border border-slate-400/15 p-3 space-y-2">
        <p className="text-xs break-all font-mono">{copy.name}</p>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500 dark:text-slate-400">{resourceBytes(copy.sizeBytes)} · {new Date(copy.createdAt).toLocaleString()} · {copy.mode}</p>
          <AppButton disabled={!canImport || busy || Boolean(importing) || localNames.includes(copy.name)} onClick={() => void retrieve(copy.name)}><DownloadCloud size={16} className="mr-2" />{importing === copy.name ? 'Importing…' : localNames.includes(copy.name) ? 'Available locally' : 'Import to local backups'}</AppButton>
        </div>
      </div>)}</div>}
    </div>}
  </section>;
}
