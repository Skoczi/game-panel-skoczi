import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { nodesRequest, type ExecutionNode, type LocalNode } from '../utils/nodesApi';

export type NodeScope = 'all' | string;
export interface ScopeNode {
  id: string;
  name: string;
  location: string;
  status: string;
}
interface NodeScopeState {
  scope: NodeScope;
  selectScope: (id: NodeScope) => void;
  nodes: ScopeNode[];
  loading: boolean;
  error: boolean;
}
const NodeScopeContext = createContext<NodeScopeState>({
  scope: 'all',
  selectScope: () => {},
  nodes: [],
  loading: false,
  error: false,
});
const validScope = /^(all|local|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i;

// A view filter only. Runtime requests retain their explicit server/node context.
export function NodeScopeProvider({
  children,
  userId,
  enabled = true,
}: {
  children: ReactNode;
  userId: number;
  enabled?: boolean;
}) {
  const storageKey = `gamepanel_node_scope_${userId}`;
  const [scope, setScope] = useState<NodeScope>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return enabled && saved && validScope.test(saved) ? saved : 'all';
    } catch {
      return 'all';
    }
  });
  const [nodes, setNodes] = useState<ScopeNode[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await nodesRequest<{ nodes: ExecutionNode[]; local?: LocalNode }>(
          '/api/nodes'
        );
        if (active) {
          setNodes([
            {
              id: 'local',
              name: result.local?.name || 'Local',
              location: result.local?.location || 'Panel host',
              status: 'online',
            },
            ...result.nodes.map((node) => ({
              ...node,
              status: node.enabled ? node.status : 'disabled',
            })),
          ]);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(refresh, 20000);
        }
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  const selectScope = (id: NodeScope) => {
    if (!enabled || !validScope.test(id)) return;
    setScope(id);
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {
      /* Selection still works in memory. */
    }
  };
  useEffect(() => {
    const change = (event: Event) => selectScope((event as CustomEvent).detail);
    window.addEventListener('gp:node-scope', change);
    return () => window.removeEventListener('gp:node-scope', change);
  }, [enabled, storageKey]);
  return (
    <NodeScopeContext.Provider value={{ scope, selectScope, nodes, loading, error }}>
      {children}
    </NodeScopeContext.Provider>
  );
}
export const useNodeScope = () => useContext(NodeScopeContext);
