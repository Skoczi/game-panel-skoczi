import { useState } from 'react';
import { nodesRequest, type LocalNode } from '../utils/nodesApi';

export function LocalRuntimeInfo({
  node,
  unavailable,
}: {
  node?: LocalNode;
  unavailable: boolean;
}) {
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt>Status</dt>
        <dd>
          {unavailable ? 'Status unavailable' : node ? 'Online · Built-in runtime' : 'Not checked'}
        </dd>
        <dt>Origin</dt>
        <dd className="break-all font-mono">
          {node?.origin || window.location.origin}{' '}
          {!node?.origin && <span className="font-sans text-slate-500">(panel origin)</span>}
        </dd>
        <dt>Agent / runtime</dt>
        <dd>{node?.agent_version || 'Unavailable'} · Built in</dd>
        <dt>Last heartbeat</dt>
        <dd>{node?.last_seen ? new Date(node.last_seen).toLocaleString() : 'Not checked'}</dd>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Local heartbeat is the last successful panel API response, not a separate agent or a
        game-server health check.
      </p>
    </>
  );
}

export function LocalNodeProfile({
  node,
  onSaved,
  onDirtyChange,
}: {
  node?: LocalNode;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    name: node?.name || 'Local',
    location: node?.location || '',
    origin: node?.origin || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-4 border-t border-slate-300 pt-4 dark:border-slate-700"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        setSaved(false);
        try {
          await nodesRequest('/api/nodes/local/profile', draft, 'PUT');
          onDirtyChange(false);
          setSaved(true);
          await onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Cannot save profile');
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3 className="font-semibold">Local node identity</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {(['name', 'location', 'origin'] as const).map((key) => (
          <label key={key} className="text-sm capitalize">
            {{ name: 'Name', location: 'Location', origin: 'Origin' }[key]}
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600"
              required={key === 'name'}
              type={key === 'origin' ? 'url' : 'text'}
              maxLength={key === 'name' ? 80 : key === 'location' ? 120 : 256}
              placeholder={
                key === 'origin'
                  ? window.location.origin
                  : key === 'location'
                    ? 'Warsaw, PL'
                    : 'Local'
              }
              value={draft[key]}
              onChange={(event) => {
                setDraft({ ...draft, [key]: event.target.value });
                onDirtyChange(true);
                setSaved(false);
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Display metadata only. An empty origin uses the panel address. Saving does not change
        routing, allocations or running servers.
      </p>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-emerald-500">
          Local node saved.
        </p>
      )}
      <button
        type="submit"
        disabled={saving || !node}
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save local node'}
      </button>
    </form>
  );
}
