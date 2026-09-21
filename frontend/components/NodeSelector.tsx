import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Server } from 'lucide-react';
import { useNodeScope } from '../contexts/NodeScopeContext';

export function NodeSelector({ onSelect }: { onSelect?: (id: string) => void | Promise<void> }) {
  const { scope, selectScope, nodes, loading, error } = useNodeScope();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const options = [
    {
      id: 'all',
      name: 'All nodes',
      detail: '',
      status: 'all',
    },
    ...(scope !== 'all' && !nodes.some((node) => node.id === scope)
      ? [{ id: scope, name: 'Selected node', detail: 'Unavailable', status: 'offline' }]
      : []),
    ...nodes.map((node) => ({ ...node, detail: node.location || 'Remote host' })),
  ];
  const selected = options.find((node) => node.id === scope)!;
  const activeIndex = Math.min(highlight, options.length - 1);
  const statusLabel = (status: string) =>
    ({
      all: 'All locations',
      online: 'Online',
      offline: 'Offline',
      pending: 'Awaiting enrollment',
      disabled: 'Disabled',
    })[status] || status;
  const choose = async (id: string) => {
    setOpen(false);
    trigger.current?.focus();
    if (id !== scope) await (onSelect || selectScope)(id);
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
  return (
    <div
      ref={root}
      className="gp-node-selector"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="sr-only" id={`${listId}-label`}>
        Node scope
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
        onClick={async () => {
          setHighlight(options.findIndex((node) => node.id === scope));
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
                    ? options.findIndex((node) => node.id === scope)
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
        </span>
        <span className="gp-node-caption" title={loading ? 'Loading nodes…' : error ? 'Status unavailable' : statusLabel(selected.status)}>
          <i data-status={error ? 'offline' : selected.status} />
          <span className="sr-only">{statusLabel(selected.status)}</span>
        </span>
        <ChevronDown size={16} className="gp-node-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="gp-node-popover">
          <div id={listId} role="listbox" aria-label="Node scopes" className="gp-node-options">
            {options.map((node, index) => (
              <div
                key={node.id}
                id={`${listId}-${index}`}
                role="option"
                aria-label={`${node.name}${node.detail ? ` · ${node.detail}` : ''} · ${statusLabel(node.status)}`}
                aria-selected={node.id === scope}
                className="gp-node-option"
                data-highlighted={index === activeIndex}
                onPointerMove={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(node.id)}
              >
                <span className="gp-node-caption" title={statusLabel(node.status)}>
                  <i data-status={node.status} /><span className="sr-only">{statusLabel(node.status)}</span>
                </span>
                <span className="gp-node-copy">
                  <span className="gp-node-name">{node.name}</span>
                  {node.detail && <span className="gp-node-location" title={node.detail}>{node.detail}</span>}
                </span>
                {node.id === scope && (
                  <Check className="gp-node-check" size={16} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>

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
