import { AppButton, AppToggle } from '../../src/ui/components';
import { useState } from 'react';
import { apiClient } from '../../utils/api';
import type { GameTemplate } from '../../utils/gameTemplates';

export function NativeRuntimeCard({ template, version, serverId, status, isRoot }: { template: GameTemplate; version: number; serverId: number; status?: string | null; isRoot: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dispatched, setDispatched] = useState(false);
  return <section className="space-y-4 rounded-2xl border border-blue-500/30 bg-blue-500/5 p-5">
    <div><h4 className="font-semibold">Native Runtime · Template v{version}</h4><p className="text-sm opacity-70">{template.name}. Startup uses the installed snapshot; publishing a new template does not change this server.</p></div>
    <details><summary className="cursor-pointer text-sm">Startup arguments</summary><pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-200">{template.lifecycle?.startup.join('\n')}</pre></details>
    {isRoot && !!template.lifecycle?.update.length && <>
      <p className="text-sm">Updates use the saved local recipe and can overwrite game files. Stop the server and take a backup first. An update does not start the server afterwards.</p>
      <AppToggle checked={confirmed} onChange={setConfirmed} label="I have a backup and want to run this update." />
      <AppButton tone="primary" disabled={!confirmed || busy || dispatched || !['stopped', 'failed'].includes(status || '')} onClick={async () => {
        setBusy(true); setMessage('');
        try { const result = await apiClient.updateNativeServer(serverId); setDispatched(true); setMessage(result.message); }
        catch (e: any) {
          setMessage(e?.response?.data?.error || 'Update result is unknown. Check Activity before retrying.');
          if (!e?.response || e.response.status >= 500) setDispatched(true);
        } finally { setBusy(false); }
      }}>{busy ? 'Submitting…' : 'Run native update'}</AppButton>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
