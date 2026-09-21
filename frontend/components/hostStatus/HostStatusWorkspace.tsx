import { useNodeScope } from '../../contexts/NodeScopeContext';
import { HostStatus } from '../HostStatus';
import { AppButton } from '../../src/ui/components';

export function HostStatusWorkspace() {
  const { scope, selectScope, nodes, loading, error } = useNodeScope();
  const visible = scope === 'all' ? nodes : nodes.filter((node) => node.id === scope);
  return (
    <section className="space-y-6" aria-label="Host status">
      <header className="gp-page-header"><h1 className="gp-page-title">Host Status</h1></header>
      {loading && <p role="status">Loading nodes…</p>}
      {error && <p role="status">Node list unavailable. Retrying…</p>}
      {!loading && !error && !visible.length && (
        <p role="status">
          Selected node is no longer available. Choose another node in the sidebar.
        </p>
      )}
      {visible.map((node) => (
        <section
          key={`${scope}:${node.id}`}
          aria-label={`${node.name} metrics`}
          className="space-y-3"
        >
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{node.name}</h2>
              <p className="text-sm text-gray-400">{node.location}</p>
            </div>
            {scope === 'all' && (
              <AppButton
                tone="neutral"
                className="px-3"
                onClick={() => selectScope(node.id)}
                aria-label={`View ${node.name} details`}
              >
                View details
              </AppButton>
            )}
          </header>
          {node.status === 'disabled' || node.status === 'pending' ? (
            <p
              role="status"
              className="rounded-lg border border-gray-500/20 p-5 text-sm text-gray-400"
            >
              {node.status === 'disabled' ? 'Node disabled.' : 'Awaiting node enrollment.'} Metrics
              unavailable.
            </p>
          ) : (
            <HostStatus nodeId={node.id} compact={scope === 'all'} />
          )}
        </section>
      ))}
    </section>
  );
}
