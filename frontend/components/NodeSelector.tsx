import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Server, Radio } from 'lucide-react';
import { ACTIVE_NODE, selectNode } from '../utils/nodeContext';
import { nodesRequest, type ExecutionNode, type LocalNode } from '../utils/nodesApi';

export function NodeSelector() {
  const [nodes, setNodes] = useState<ExecutionNode[]>([]);
  const [local, setLocal] = useState<LocalNode>();
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const options = [
    {
      id: 'local',
      name: local?.name || 'Local',
      detail: local?.location || 'Panel host',
      status: 'local',
    },
    ...(ACTIVE_NODE !== 'local' && !nodes.some((node) => node.id === ACTIVE_NODE)
      ? [{ id: ACTIVE_NODE, name: 'Selected node', detail: 'Unavailable', status: 'offline' }]
      : []),
    ...nodes.map((node) => ({ ...node, detail: node.location || 'Remote host' })),
  ];
  const selected = options.find((node) => node.id === ACTIVE_NODE)!;
  const activeIndex = Math.min(highlight, options.length - 1);
  const statusLabel = (status: string) =>
    ({
      local: 'Local runtime',
      online: 'Online',
      offline: 'Offline',
      pending: 'Awaiting enrollment',
      disabled: 'Disabled',
    })[status] || status;
  const choose = (id: string) => {
    setOpen(false);
    trigger.current?.focus();
    if (
      id !== ACTIVE_NODE &&
      window.confirm('Switch execution node? Open consoles and unsaved forms will close.')
    )
      selectNode(id);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open)
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listId]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void nodesRequest<{ nodes: ExecutionNode[]; local?: LocalNode }>('/api/nodes')
        .then((result) => {
          if (active) {
            setNodes(result.nodes);
            setLocal(result.local);
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
    <div
      ref={root}
      className="gp-node-selector"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="gp-node-eyebrow" id={`${listId}-label`}>
        <Radio size={12} aria-hidden="true" /> Execution node
      </div>
      <button
        ref={trigger}
        id="active-node"
        type="button"
        role="combobox"
        aria-labelledby={`${listId}-label ${listId}-value`}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        className="gp-node-trigger"
        onClick={() => {
          setHighlight(options.findIndex((node) => node.id === ACTIVE_NODE));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            event.preventDefault();
          }
          if (event.key === 'Tab') setOpen(false);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            setHighlight(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : !open
                    ? options.findIndex((node) => node.id === ACTIVE_NODE)
                    : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                      options.length
            );
          }
          if (open && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            choose(options[activeIndex].id);
          }
          if (open && event.key.length === 1 && /\S/.test(event.key)) {
            const index = options.findIndex(
              (node, index) =>
                index > activeIndex && node.name.toLowerCase().startsWith(event.key.toLowerCase())
            );
            const match =
              index < 0
                ? options.findIndex((node) =>
                    node.name.toLowerCase().startsWith(event.key.toLowerCase())
                  )
                : index;
            if (match >= 0) {
              event.preventDefault();
              setHighlight(match);
            }
          }
        }}
      >
        <span className="gp-node-icon">
          <Server size={18} aria-hidden="true" />
        </span>
        <span className="gp-node-copy">
          <span id={`${listId}-value`} className="gp-node-name">
            {selected.name}
          </span>
          <span className="gp-node-caption">
            <i data-status={error ? 'offline' : selected.status} />
            {error ? 'Status unavailable' : statusLabel(selected.status)}
          </span>
        </span>
        <ChevronDown size={16} className="gp-node-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="gp-node-popover">
          <div className="gp-node-menu-heading">
            Available runtimes <span>{options.length}</span>
          </div>
          <div id={listId} role="listbox" aria-label="Execution nodes" className="gp-node-options">
            {options.map((node, index) => (
              <div
                key={node.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={node.id === ACTIVE_NODE}
                className="gp-node-option"
                data-highlighted={index === activeIndex}
                onPointerMove={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(node.id)}
              >
                <span className="gp-node-copy">
                  <span className="gp-node-name">{node.name}</span>
                  <span className="gp-node-location" title={node.detail}>
                    {node.detail}
                  </span>
                  <span className="gp-node-caption">
                    <i data-status={node.status} />
                    <span>
                      {node.status === 'pending' ? 'Not paired' : statusLabel(node.status)}
                    </span>
                  </span>
                </span>
                {node.id === ACTIVE_NODE && (
                  <Check className="gp-node-check" size={16} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
          <div className="gp-node-menu-note">Switching closes open consoles and forms.</div>
        </div>
      )}
      {error && (
        <p role="status" className="mt-2 text-xs text-amber-200">
          Node list unavailable. Current selection retained.
        </p>
      )}
    </div>
  );
}
