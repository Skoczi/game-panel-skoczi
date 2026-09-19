import { ArrowDown, ArrowUp, Copy, Play, RotateCw, Settings, Square, Terminal } from 'lucide-react';
import { formatNetworkSpeed, getServerStatusPresentation } from './gameServersTable/utils';
import { fleetAllowed, type FleetRuntime } from '../utils/fleetRuntime';

export function FleetStatus({ status, available }: { status: string; available: boolean }) {
  const value = getServerStatusPresentation(available ? status : 'unknown');
  return (
    <span
      data-status={available ? value.normalizedStatus : 'unknown'}
      className={`fleet-node-status ${value.className}`}
    >
      {available ? value.label : 'Unavailable'}
    </span>
  );
}

export function FleetAddress({
  runtime,
  name,
  onCopy,
}: {
  runtime?: FleetRuntime;
  name: string;
  onCopy: () => void;
}) {
  return (
    <div className="fleet-node-address">
      <code>{runtime?.address || '—'}</code>
      {runtime?.address && (
        <button
          title="Copy connection address"
          aria-label={`Copy address for ${name}`}
          onClick={onCopy}
        >
          <Copy size={16} />
        </button>
      )}
    </div>
  );
}

export function FleetMetrics({
  runtime,
  compact = false,
}: {
  runtime?: FleetRuntime;
  compact?: boolean;
}) {
  return (
    <div className={`fleet-node-metrics ${compact ? 'is-compact' : ''}`}>
      {(compact
        ? (['cpuUsage', 'memoryUsage'] as const)
        : (['cpuUsage', 'memoryUsage', 'diskUsage'] as const)
      ).map((key, index) => {
        const value = runtime?.server[key];
        return (
          <div className="fleet-node-metric" key={key}>
            <span>{index === 0 ? 'CPU' : index === 1 ? (compact ? 'RAM' : 'Memory') : 'Disk'}</span>
            <strong>{value == null ? '—' : `${value.toFixed(1)}%`}</strong>
            <div className="fleet-node-track">
              <i style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
            </div>
          </div>
        );
      })}
      {!compact && (
        <div className="fleet-node-network">
          <span>Network</span>
          <div>
            <ArrowUp size={13} />
            {runtime?.server.networkOut == null
              ? '—'
              : formatNetworkSpeed(runtime.server.networkOut)}
            <ArrowDown size={13} />
            {runtime?.server.networkIn == null ? '—' : formatNetworkSpeed(runtime.server.networkIn)}
          </div>
        </div>
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
