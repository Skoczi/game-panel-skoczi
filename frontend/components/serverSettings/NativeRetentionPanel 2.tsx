import { useId, useState } from 'react';
import { AppButton, AppInput } from '../../src/ui/components';
import { apiClient, type NativeRetentionPlan } from '../../utils/api';
import { apiErrorMessage } from '../../utils/apiError';
import { ConfirmationModal } from '../ConfirmationModal';
export function NativeRetentionPanel({ serverId, onChanged }: { serverId: number; onChanged: () => void }) {
  const id = useId();
  const [policy, setPolicy] = useState({ keepArchives: 5, keepRecovery: 2 });
  const [plan, setPlan] = useState<NativeRetentionPlan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [confirm, setConfirm] = useState(false);
  const valid = [policy.keepArchives, policy.keepRecovery].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 100);
  const preview = async () => {
    setPending(true); setError(''); setResult(''); setPlan(null);
    try { setPlan(await apiClient.previewNativeRetention(serverId, policy)); }
    catch (cause) { setError(apiErrorMessage(cause, 'Unable to preview cleanup.')); }
    finally { setPending(false); }
  };
  const apply = async () => {
    if (!plan || pending) return;
    setPending(true); setError(''); setResult('');
    try {
      const response = await apiClient.applyNativeRetention(serverId, plan);
      setResult(`Cleanup completed: ${response.removed.length} item(s) removed. Refresh the protection summary for new storage measurements.`);
    } catch (cause) { setError(apiErrorMessage(cause, 'Could not confirm cleanup. Refresh the backup list and preview before trying again.')); }
    finally { setPending(false); setPlan(null); setConfirm(false); onChanged(); }
  };
  return <details className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
    <summary className="cursor-pointer font-medium">Clean up older backups and recovery</summary>
    <div className="space-y-3 pt-3 text-sm">
      <p className="text-gray-500 dark:text-gray-400">Manual cleanup with separate keep counts. The latest recorded backup and incomplete recovery are retained in addition to these counts. Nothing is deleted until you review and confirm.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(['keepArchives', 'keepRecovery'] as const).map(key => <div key={key}>
          <label htmlFor={`${id}-${key}`} className="block mb-1">{key === 'keepArchives' ? 'Keep newest archives' : 'Keep newest completed recovery directories'}</label>
          <AppInput id={`${id}-${key}`} type="number" min={1} max={100} disabled={pending} value={policy[key]} onChange={event => { setPolicy(value => ({ ...value, [key]: Number(event.target.value) })); setPlan(null); setResult(''); }} />
        </div>)}
      </div>
      {!valid && <p role="alert">Keep between 1 and 100 of each type.</p>}
      <AppButton disabled={pending || !valid} onClick={() => void preview()}>{pending ? 'Working…' : 'Preview cleanup'}</AppButton>
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {result && <p role="status">{result}</p>}
      {plan && <section aria-label="Cleanup preview" className="space-y-3">
        <p>{plan.remove.length} item(s) to remove · {plan.keep.length} retained.</p>
        {plan.remove.length === 0 ? <p>Nothing to remove under these rules.</p> : <ul className="max-h-48 overflow-y-auto space-y-1">{plan.remove.map(entry => <li className="break-all" key={entry.name}>{entry.name} · {entry.kind}</li>)}</ul>}
        <details><summary className="cursor-pointer">Retained items and reasons</summary><ul className="max-h-48 overflow-y-auto space-y-1">{plan.keep.map(entry => <li className="break-all" key={entry.name}>{entry.name} · {entry.protectedReason}</li>)}</ul></details>
        {plan.remove.length > 0 && <AppButton tone="critical" disabled={pending} onClick={() => setConfirm(true)}>Review deletion</AppButton>}
      </section>}
    </div>
    <ConfirmationModal isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={apply} title="Delete reviewed backups and recovery?" message={`Permanently remove the ${plan?.remove.length ?? 0} items listed in the cleanup preview. Retained items stay in place. A changed inventory requires a new preview.`} requiredText="DELETE" confirmText="Delete reviewed items" icon="danger" />
  </details>;
}
