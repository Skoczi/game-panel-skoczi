import { useEffect, useState } from 'react';
import { Server, Plus, RefreshCw, Shield, ExternalLink, Network } from 'lucide-react';
import { nodesRequest, type ExecutionNode } from '../utils/nodesApi';
import { ACTIVE_NODE, openFleet, selectNode } from '../utils/nodeContext';
import { GlobalSettings } from './GlobalSettings';
import {
  AppModal,
  AppModalContent,
  AppModalHeader,
  AppModalTitle,
  AppModalDescription,
  AppModalBody,
} from '../src/ui/components';

const card =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-[#111827]';
const input =
  'mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-600';
const button =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800';
const colors = {
  online: 'bg-emerald-100 text-emerald-800',
  offline: 'bg-amber-100 text-amber-800',
  disabled: 'bg-slate-200 text-slate-700',
  pending: 'bg-blue-100 text-blue-800',
};
export function Nodes() {
  const [nodes, setNodes] = useState<ExecutionNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [enrollment, setEnrollment] = useState<{ nodeId: string; token: string } | null>(null);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [nodeTab, setNodeTab] = useState<'overview' | 'allocations'>('overview');
  const [allocationDirty, setAllocationDirty] = useState(false);
  const [draft, setDraft] = useState({ name: '', origin: '', location: '' });
  const [deleting, setDeleting] = useState<ExecutionNode | null>(null);
  const [confirmationName, setConfirmationName] = useState('');
  const [deleteError, setDeleteError] = useState('');
  async function refresh() {
    try {
      const value = await nodesRequest<{ nodes: ExecutionNode[] }>('/api/nodes');
      setNodes(value.nodes);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot load nodes');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, []);
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await run();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }
  const leaveAllocations = () =>
    !allocationDirty || window.confirm('Discard unsaved allocation changes?');
  if (selected) {
    const node = nodes.find((n) => n.id === selected.id);
    const local = selected.id === 'local';
    return (
      <div className="space-y-5 text-slate-900 dark:text-slate-100">
        <button
          className={button}
          onClick={() => {
            if (leaveAllocations()) {
              setSelected(null);
              setAllocationDirty(false);
            }
          }}
        >
          ← Nodes
        </button>
        <header className={`${card} flex flex-wrap items-center justify-between gap-4`}>
          <div>
            <p className="text-xs uppercase tracking-widest text-blue-600 dark:text-blue-400">
              Node settings
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{selected.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {local ? 'Panel host · Built-in runtime' : node?.location || 'Remote runtime'}
            </p>
          </div>
          <button
            className={button}
            disabled={!local && (!node || !node.enabled || node.status === 'pending')}
            onClick={() => {
              if (leaveAllocations()) selectNode(selected.id);
            }}
          >
            Open servers
          </button>
        </header>
        <nav
          aria-label="Node settings sections"
          className="flex gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700"
        >
          {(['overview', 'allocations'] as const).map((tab) => (
            <button
              key={tab}
              aria-current={nodeTab === tab ? 'page' : undefined}
              className={`${button} ${nodeTab === tab ? '!bg-blue-700 !text-white' : ''}`}
              onClick={() => {
                if (nodeTab !== tab && leaveAllocations()) {
                  setAllocationDirty(false);
                  setNodeTab(tab);
                }
              }}
            >
              {tab === 'overview' ? 'Overview' : 'IP allocations'}
            </button>
          ))}
        </nav>
        {nodeTab === 'allocations' ? (
          <GlobalSettings
            key={selected.id}
            nodeId={selected.id}
            nodeName={selected.name}
            onDirtyChange={setAllocationDirty}
          />
        ) : (
          <section className={`${card} space-y-4`}>
            <h2 className="text-lg font-semibold">Runtime information</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <dt>Status</dt>
              <dd>{local ? 'Built in' : node?.status || 'Unavailable'}</dd>
              <dt>Agent</dt>
              <dd>
                {local ? 'No additional agent required' : node?.agent_version || 'Not enrolled'}
              </dd>
              {!local && (
                <>
                  <dt>Origin</dt>
                  <dd className="break-all font-mono">{node?.origin || 'Unavailable'}</dd>
                  <dt>Last heartbeat</dt>
                  <dd>
                    {node?.last_seen
                      ? new Date(node.last_seen).toLocaleString()
                      : 'Waiting for agent'}
                  </dd>
                </>
              )}
            </dl>
            <p className="text-sm text-slate-500">
              IP addresses and TCP/UDP ranges belong to this node. Existing servers stay on their
              current runtime.
            </p>
          </section>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
            Infrastructure
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Nodes</h1>
          <p className="mt-2 text-sm text-slate-500">
            One control panel. Separate runtimes, files and IP allocations.
          </p>
        </div>
        <div className="flex gap-2">
          <button className={button} onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            className={`${button} gp-node-primary bg-blue-700 text-white hover:bg-blue-800`}
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus size={16} />
            Add node
          </button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
        <Shield className="shrink-0" size={20} />
        <p>
          Node administration grants control over the host Docker runtime. Remote access is
          restricted to administrators. Users open their assigned servers from Game Servers;
          location and routing are handled by the panel.
        </p>
      </div>
      {showCreate && (
        <form
          className={`${card} grid gap-4 md:grid-cols-3`}
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              const result = await nodesRequest<{ node: ExecutionNode; enrollmentToken: string }>(
                '/api/nodes',
                draft
              );
              setEnrollment({ nodeId: result.node.id, token: result.enrollmentToken });
              setDraft({ name: '', origin: '', location: '' });
              setShowCreate(false);
            });
          }}
        >
          <label className="text-sm">
            Name
            <input
              className={input}
              required
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Warsaw · Games"
            />
          </label>
          <label className="text-sm">
            Agent HTTPS origin
            <input
              className={input}
              type="url"
              required
              value={draft.origin}
              onChange={(e) => setDraft({ ...draft, origin: e.target.value })}
              placeholder="https://node.example.com"
            />
          </label>
          <label className="text-sm">
            Location
            <input
              className={input}
              maxLength={120}
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="Warsaw, PL"
            />
          </label>
          <p className="text-xs text-slate-500 md:col-span-2">
            The origin is for agent management, not a game allocation. Configure verified HTTPS
            before enrollment.
          </p>
          <button className={button} disabled={busy} type="submit">
            {busy ? 'Creating…' : 'Create enrollment'}
          </button>
        </form>
      )}
      {enrollment && (
        <section className={`${card} space-y-3`} aria-label="Node enrollment">
          <h2 className="text-lg font-semibold">Connect your agent</h2>
          <p className="text-sm text-slate-500">
            One-time token, valid for 15 minutes. Paste it into the installer prompt; never put it
            in command history or a URL.
          </p>
          <p className="break-all font-mono text-xs">Node ID: {enrollment.nodeId}</p>
          <label className="block text-sm">
            Enrollment token
            <input
              className={`${input} font-mono`}
              readOnly
              type="password"
              value={enrollment.token}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className={button}
              onClick={() =>
                void navigator.clipboard
                  .writeText(enrollment.token)
                  .catch(() => setError('Clipboard unavailable. Select and copy the token field.'))
              }
            >
              Copy token
            </button>
            <a
              className={button}
              href="https://github.com/Skoczi/game-panel-skoczi/blob/main/docs/skoczi/NODES.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              Installation guide
              <ExternalLink size={14} />
            </a>
            <button className={button} onClick={() => setEnrollment(null)}>
              Dismiss token
            </button>
          </div>
        </section>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <article className={card}>
          <div className="flex items-center gap-3">
            <Server className="text-blue-600" />
            <h2 className="font-semibold">Local</h2>
            <span className="ml-auto rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              Built in
            </span>
          </div>
          <p className="my-4 text-sm text-slate-500">
            Create and manage servers on the panel host. No additional agent is required.
          </p>
          <button className={button} disabled={busy} onClick={() => selectNode('local')}>
            Open local servers
          </button>
          <button
            className={`${button} ml-2`}
            onClick={() => {
              setSelected({ id: 'local', name: 'Local' });
              setNodeTab('overview');
            }}
          >
            <Network size={14} />
            Node settings
          </button>
        </article>
        {nodes.map((node) => (
          <article key={node.id} className={`${card} space-y-4`}>
            <div className="flex items-center gap-3">
              <Server className="shrink-0 text-blue-600" />
              <div className="min-w-0">
                <h2 className="break-words font-semibold">{node.name}</h2>
                <p className="text-xs text-slate-500">{node.location || 'No location set'}</p>
              </div>
              <span
                className={`ml-auto rounded-full px-2 py-1 text-xs font-medium ${colors[node.status]}`}
              >
                {node.status}
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-slate-500">Origin</dt>
              <dd className="break-all font-mono">{node.origin}</dd>
              <dt className="text-slate-500">Agent</dt>
              <dd>{node.agent_version || 'Not enrolled'}</dd>
              <dt className="text-slate-500">Last heartbeat</dt>
              <dd>
                {node.last_seen ? new Date(node.last_seen).toLocaleString() : 'Waiting for agent'}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy || node.status === 'disabled' || node.status === 'pending'}
                onClick={() => selectNode(node.id)}
              >
                Open servers
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setSelected(node);
                  setNodeTab('overview');
                }}
              >
                <Network size={14} />
                Node settings
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `${node.enabled ? 'Disable management of' : 'Enable'} ${node.name}? Running games are not stopped.`
                    )
                  )
                    void action(async () => {
                      await nodesRequest(
                        `/api/nodes/${node.id}`,
                        { enabled: !node.enabled },
                        'PATCH'
                      );
                    });
                }}
              >
                {node.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Revoke this agent credential? Re-enrollment is required; games keep running.'
                    )
                  )
                    void action(async () => {
                      const result = await nodesRequest<{ enrollmentToken: string }>(
                        `/api/nodes/${node.id}/credentials`,
                        {}
                      );
                      setEnrollment({ nodeId: node.id, token: result.enrollmentToken });
                    });
                }}
              >
                Re-enroll
              </button>
              <button
                className={`${button} text-red-700 dark:text-red-300`}
                disabled={busy || Boolean(node.enabled && node.status !== 'pending')}
                title={
                  node.enabled && node.status !== 'pending'
                    ? 'Disable this node before deleting it'
                    : 'Delete this node from the panel'
                }
                onClick={() => {
                  setDeleting(node);
                  setConfirmationName('');
                  setDeleteError('');
                }}
              >
                Delete node
              </button>
            </div>
          </article>
        ))}
      </div>
      <AppModal
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AppModalContent className="max-w-lg rounded-2xl p-5">
          <AppModalHeader className="pr-6">
            <AppModalTitle>Delete node</AppModalTitle>
            <AppModalDescription className="mt-2">
              Remove {deleting?.name} from this panel and revoke its enrollment. This does not
              uninstall the agent or delete host files or containers.
            </AppModalDescription>
          </AppModalHeader>
          <AppModalBody className="mt-4">
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!deleting || busy || confirmationName !== deleting.name) return;
                setBusy(true);
                setDeleteError('');
                try {
                  await nodesRequest(`/api/nodes/${deleting.id}`, { confirmationName }, 'DELETE');
                  if (enrollment?.nodeId === deleting.id) setEnrollment(null);
                  if (ACTIVE_NODE === deleting.id) {
                    openFleet();
                    return;
                  }
                  setDeleting(null);
                  await refresh();
                } catch (err) {
                  setDeleteError(err instanceof Error ? err.message : 'Cannot delete node');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm text-slate-500">
                Tracked servers block deletion. Previously connected agents must be reachable and
                empty.
              </p>
              <label className="block text-sm">
                Type the node name to confirm
                <input
                  className={input}
                  value={confirmationName}
                  onChange={(e) => setConfirmationName(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                />
              </label>
              {deleteError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-300">
                  {deleteError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => setDeleting(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${button} !border-red-700 !bg-red-700 !text-white hover:!bg-red-800`}
                  disabled={busy || confirmationName !== deleting?.name}
                >
                  {busy ? 'Checking and deleting…' : 'Confirm deletion'}
                </button>
              </div>
            </form>
          </AppModalBody>
        </AppModalContent>
      </AppModal>
      {loading && <p role="status">Loading nodes…</p>}
      {!loading && !nodes.length && (
        <p className="py-6 text-center text-sm text-slate-500">
          No remote nodes yet. Add a node to generate its enrollment token.
        </p>
      )}
    </div>
  );
}
