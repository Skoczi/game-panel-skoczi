import { useEffect, useState } from 'react';
import { nodesRequest } from '../utils/nodesApi';
import { runtimePrefix } from '../utils/nodeContext';
import { AppButton } from '../src/ui/components';

type RuntimeInfo = {
  status: string;
  version?: string;
  commit?: string | null;
  build?: string | null;
  capabilities?: Record<string, number>;
};
const capabilities = [
  ['versionedFiles', 'Conflict-safe file saves'],
  ['backupJobs', 'Persistent backup operations'],
  ['nativeRestoreRecovery', 'Native restore recovery'],
  ['absoluteResources', 'Resource usage and assigned limits'],
] as const;

export function RuntimeCapabilities({ nodeId }: { nodeId: string }) {
  const [info, setInfo] = useState<RuntimeInfo>();
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setInfo(undefined); setError(false); setCheckedAt('');
    void nodesRequest<RuntimeInfo>(`${runtimePrefix(nodeId)}/api/health`).then(value => {
      if (value?.status !== 'healthy') throw new Error('Invalid runtime response');
      if (active) { setInfo(value); setCheckedAt(new Date().toLocaleString()); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [nodeId, revision]);
  return <section aria-label="Runtime compatibility" className="space-y-3 border-t border-slate-500/20 pt-4 text-sm">
    <h3 className="font-semibold">Runtime compatibility</h3>
    {!info && <p role="status">{error ? 'Runtime could not be reached. Game state is unknown; this does not mean the game has stopped.' : 'Checking runtime…'}</p>}
    {info && <>
      <p className="text-slate-500">Checked {checkedAt}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
        <dt>Version</dt><dd>{info.version || 'Not reported'}</dd>
        <dt>Build</dt><dd>{info.build || 'Not recorded'}</dd>
        <dt>Commit</dt><dd className="break-all font-mono">{info.commit || 'Not recorded'}</dd>
      </dl>
      <ul className="space-y-1">{capabilities.map(([key, label]) => <li key={key}>{label}: <strong>{info.capabilities?.[key] === 1 ? 'Supported' : 'Agent update required'}</strong></li>)}</ul>
    </>}
    <AppButton onClick={() => setRevision(value => value + 1)}>Check compatibility</AppButton>
  </section>;
}
