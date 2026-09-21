import { resourceLabel } from '../utils/resourceMetrics';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Play,
  RotateCw,
  Settings,
  Square,
  Terminal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatNetworkSpeed, getServerStatusPresentation } from './gameServersTable/utils';
import { fleetAllowed, type FleetRuntime } from '../utils/fleetRuntime';
import type { FleetMetricType } from './FleetMetricsModal';

export function FleetStatus({
  status,
  available,
  name,
  onClick,
}: {
  status: string;
  available: boolean;
  name: string;
  onClick: () => void;
}) {
  const value = getServerStatusPresentation(available ? status : 'unknown');
  return (
    <button
      type="button"
      title="Open history logs"
      aria-label={`Open history logs for ${name}`}
      onClick={onClick}
      data-status={available ? value.normalizedStatus : 'unknown'}
      className={`fleet-node-status ${value.className}`}
    >
      {available ? value.label : 'Unavailable'}
    </button>
  );
}

export function FleetAddress({ runtime, name }: { runtime?: FleetRuntime; name: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(runtime!.address!);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
      setCopied(false);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  };
  return (
    <div className="fleet-node-address">
      {runtime?.address ? (
        <button
          className="fleet-address-text"
          title="Copy connection address"
          aria-label={`Copy connection address for ${name}`}
          onClick={() => void copy()}
        >
          <code>{runtime.address}</code>
        </button>
      ) : (
        <code>—</code>
      )}
      {runtime?.address && (
        <button
          title="Copy connection address"
          aria-label={`Copy address for ${name}`}
          onClick={() => void copy()}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      )}
      {(copied || failed) && (
        <span role="status" className="fleet-copy-feedback">
          {copied ? 'Copied' : 'Copy failed'}
        </span>
      )}
    </div>
  );
}

export function FleetMetrics({
  runtime,
  compact = false,
  name,
  onOpen,
}: {
  runtime?: FleetRuntime;
  compact?: boolean;
  name: string;
  onOpen: (metric: FleetMetricType) => void;
}) {
  return (
    <div className={`fleet-node-metrics ${compact ? 'is-compact' : ''}`}>
      {(compact
        ? (['cpuUsage', 'memoryUsage'] as const)
        : (['cpuUsage', 'memoryUsage', 'diskUsage'] as const)
      ).map((key, index) => {
        const resources = runtime?.server.resources;
        const value = key === 'cpuUsage' ? resources?.cpuLimitPercent : key === 'memoryUsage' ? resources?.memoryLimitPercent : undefined;
        return (
          <button
            type="button"
            className="fleet-node-metric"
            key={key}
            title={`Open ${index === 0 ? 'CPU' : index === 1 ? 'Memory' : 'Disk'} history`}
            aria-label={`Open ${index === 0 ? 'CPU' : index === 1 ? 'Memory' : 'Disk'} history for ${name}`}
            onClick={() => onOpen(index === 0 ? 'cpu' : index === 1 ? 'memory' : 'disk')}
          >
            <span>{index === 0 ? 'CPU' : index === 1 ? (compact ? 'RAM' : 'Memory') : 'Disk'}</span>
            <strong>{resourceLabel(resources, index === 0 ? 'cpu' : index === 1 ? 'memory' : 'disk')}</strong>
            <span className="fleet-node-track">
              <i style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
            </span>
          </button>
        );
      })}
      {!compact && (
        <button
          type="button"
          className="fleet-node-network"
          title="Open Network history"
          aria-label={`Open Network history for ${name}`}
          onClick={() => onOpen('network')}
        >
          <span>Network</span>
          <span className="fleet-node-network-values">
            <ArrowUp size={13} />
            {runtime?.server.networkOut == null
              ? '—'
              : formatNetworkSpeed(runtime.server.networkOut)}
            <ArrowDown size={13} />
            {runtime?.server.networkIn == null ? '—' : formatNetworkSpeed(runtime.server.networkIn)}
          </span>
        </button>
      )}
    </div>
  );
}

export function FleetPower({
  runtime,
  name,
  disabled,
  compact = false,
  onAction,
}: {
  runtime?: FleetRuntime;
  name: string;
  disabled: boolean;
  compact?: boolean;
  onAction: (action: string) => void;
}) {
  if (!runtime || !fleetAllowed(runtime.context, 'server.power'))
    return <span className="fleet-node-no-action">—</span>;
  const running = runtime.server.status === 'running';
  const allowed = ['running', 'stopped', 'exited', 'error'].includes(runtime.server.status);
  return (
    <div className={`fleet-node-power ${compact ? 'is-compact' : ''}`}>
      {(running ? ['stop', 'restart'] : ['start', 'restart']).map((action) => (
        <button
          key={action}
          className={`fleet-node-${action}`}
          disabled={disabled || !allowed || (!running && action === 'restart')}
          aria-label={`${action} ${name}`}
          title={action === 'stop' ? 'Stop' : action === 'start' ? 'Start' : 'Restart'}
          onClick={() => onAction(action)}
        >
          {action === 'stop' ? (
            <Square size={18} />
          ) : action === 'start' ? (
            <Play size={18} />
          ) : (
            <RotateCw size={18} />
          )}
          {!compact && (
            <span>{action === 'stop' ? 'Stop' : action === 'start' ? 'Start' : 'Restart'}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function FleetManagement({
  runtime,
  disabled,
  onManage,
  onConsole,
}: {
  runtime?: FleetRuntime;
  disabled: boolean;
  onManage: () => void;
  onConsole: () => void;
}) {
  return (
    <div className="fleet-node-management">
      <button className="fleet-node-manage" disabled={disabled} onClick={onManage}>
        <Settings size={17} />
        Manage
      </button>
      <button
        className="fleet-node-console"
        disabled={disabled || !runtime || !fleetAllowed(runtime.context, 'container.logs.read')}
        onClick={onConsole}
      >
        <Terminal size={18} />
        Log/Console
      </button>
    </div>
  );
}
