import { useEffect, useState } from 'react';
import { ACTIVE_NODE, selectNode } from '../utils/nodeContext';
import { nodesRequest, type ExecutionNode } from '../utils/nodesApi';

export function NodeSelector() {
  const [nodes, setNodes] = useState<ExecutionNode[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void nodesRequest<{ nodes: ExecutionNode[] }>('/api/nodes')
        .then((result) => {
          if (active) {
            setNodes(result.nodes);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="gp-node-selector border-b border-white/15 px-3 py-3 text-white">
      <label
        className="block text-[10px] font-semibold uppercase tracking-widest text-blue-200"
        htmlFor="active-node"
      >
        Execution node
      </label>
      <select
        id="active-node"
        value={ACTIVE_NODE}
        className="mt-2 w-full rounded-lg border border-white/20 bg-[#071b70] p-2 text-xs text-white"
        onChange={(event) => {
          if (window.confirm('Switch execution node? Open consoles and unsaved forms will close.'))
            selectNode(event.target.value);
        }}
      >
        <option value="local">Local</option>
        {ACTIVE_NODE !== 'local' && !nodes.some((node) => node.id === ACTIVE_NODE) && (
          <option value={ACTIVE_NODE}>Selected node unavailable</option>
        )}
        {nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.name} · {node.status}
          </option>
        ))}
      </select>
      {error && (
        <p role="status" className="mt-2 text-xs text-amber-200">
          Node list unavailable. Current selection retained.
        </p>
      )}
    </div>
  );
}
