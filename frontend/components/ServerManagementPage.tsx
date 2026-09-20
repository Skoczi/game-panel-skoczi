import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Copy,
  Play,
  Square,
  RotateCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Globe,
  Users,
  Terminal,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import type { GameServer } from '../types/gameServer';
import type { AuthUser } from '../utils/permissions';
import type { ServerMetricHistoryPoint, ServerHistoryEntry } from '../utils/serverRuntime';
import { isServerDownLike, isServerUpLike } from '../utils/serverRuntime';
import { apiClient, PUBLIC_CONNECTION_HOST } from '../utils/api';
import { ACTIVE_NODE, ACTIVE_SERVER } from '../utils/nodeContext';
import { serverPageHash } from './serverSettings/useServerPageRoute';
import { isNativeTemplate } from '../utils/providerCapabilities';
import { gameDisplayName } from '../utils/gameDisplayName';
import {
  getServerStatusPresentation,
  formatMetricValue,
  formatNetworkSpeed,
} from './gameServersTable/utils';
import { createServerSettingsAccess, type SettingsTab } from './serverSettings/access';
import { type ServerPageTab } from './serverSettings/useServerPageRoute';
import { ServerSettingsModal } from './ServerSettingsModal';
import { ConfirmationModal } from './ConfirmationModal';
import { FleetAccess } from './FleetWorkspace';
import './serverSettings/server-page.css';

interface Props {
  server: GameServer;
  currentUser: AuthUser | null;
  permissions: string[];
  gameName: string;
  nodeName: string;
  tab: ServerPageTab;
  onTab: (tab: ServerPageTab) => void;
  onBack: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onAction: (id: string, name: string, action: string) => Promise<void>;
  onLoadMetrics: (id: string) => void;
  metrics: ServerMetricHistoryPoint[];
  history: ServerHistoryEntry[];
  consoleContent: ReactNode;
}
const labels: Record<ServerPageTab, string> = {
  console: 'Console',
  filemanager: 'Files',
  gameconfig: 'Game Config',
  backup: 'Backups',
  scheduledtasks: 'Schedules',
  network: 'Network',
  containerconfig: 'Startup & Settings',
  terminal: 'Terminal',
  activity: 'Activity',
};
const metricLabels: Record<string, string> = {
  cpuUsage: 'CPU usage',
  memoryUsage: 'Memory usage',
  networkIn: 'Inbound',
  networkOut: 'Outbound',
};
function MetricTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="gp-metric-tooltip" role="status">
      <time>{new Date(Number(label)).toLocaleTimeString()}</time>
      {payload.map((entry) => {
        const key = String(entry.dataKey);
        const value = Number(entry.value);
        return (
          <div className="gp-metric-tooltip-row" key={key}>
            <i style={{ background: entry.color }} aria-hidden="true" />
            <span>{metricLabels[key] || key}</span>
            <strong>
              {!Number.isFinite(value)
                ? '—'
                : key.startsWith('network')
                  ? formatNetworkSpeed(value)
                  : `${value.toFixed(2)}%`}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
export function ServerManagementPage({
  server,
  currentUser,
  permissions,
  gameName,
  tab,
  onTab,
  onBack,
  onDirtyChange,
  onAction,
  onLoadMetrics,
  metrics,
  history,
  consoleContent,
}: Props) {
  const allowed = (permission: string) =>
    Boolean(currentUser?.isRoot || permissions.includes('*') || permissions.includes(permission));
  const access = createServerSettingsAccess(currentUser, permissions);
  const canLogs = allowed('container.logs.read');
  const [pending, setPending] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const [consoleDockOpen, setConsoleDockOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const splitKey = `gamepanel_console_split:${currentUser?.id ?? 'guest'}`;
  const [dockWidth, setDockWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem(splitKey));
      return value >= 25 && value <= 60 ? value : 38;
    } catch {
      return 38;
    }
  });
  const [resizingDock, setResizingDock] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(splitKey, String(dockWidth));
    } catch {
      /* optional preference */
    }
  }, [dockWidth, splitKey]);
  const resizeDock = (clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (bounds?.width)
      setDockWidth(Math.max(25, Math.min(60, ((bounds.right - clientX) / bounds.width) * 100)));
  };
  const dockVisible = consoleDockOpen && canLogs && tab !== 'console';
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null);
  const [feedback, setFeedback] = useState('');
  const consoleSectionRef = useRef<HTMLElement>(null);
  const [tallConsole, setTallConsole] = useState(false);
  useEffect(() => {
    const panel = consoleSectionRef.current?.querySelector<HTMLElement>('.gp-console-panel');
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      if (panel.dataset.fullscreen === 'true') return;
      setTallConsole(panel.getBoundingClientRect().height > 660);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [tab, canLogs, server.id]);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const metricsRef = useRef(onLoadMetrics);
  metricsRef.current = onLoadMetrics;
  useEffect(() => {
    metricsRef.current(server.id);
    if (canLogs) void actionRef.current(server.id, server.name, 'debug');
  }, [server.id, canLogs]);
  useEffect(() => {
    if (!canLogs) return;
    apiClient.subscribeActions(Number(server.id), 200, 'server-management-page');
    return () => apiClient.unsubscribeActions(Number(server.id), 'server-management-page');
  }, [server.id, canLogs]);
  const status = getServerStatusPresentation(server.status);
  const host = server.connectionHost || PUBLIC_CONNECTION_HOST;
  const address = server.port
    ? `${host.includes(':') ? `[${host}]` : host}:${server.port}`
    : 'Not assigned';
  const power = async (action: string) => {
    if (!allowed('server.power') || pending) return;
    setPending(true);
    setFeedback('');
    try {
      await onAction(server.id, server.name, action);
    } catch {
      setFeedback(
        'Could not confirm the action. Check the server status, connection and your permissions before trying again.'
      );
    } finally {
      setPending(false);
      setConfirm(null);
    }
  };
  const settingsTab = !['console', 'activity', 'network'].includes(tab);
  let hasBackup = server.provider === 'linuxgsm' || isNativeTemplate(server.providerMetadataJson);
  if (server.provider === 'ovhcloud') {
    try {
      hasBackup = Boolean(JSON.parse(server.providerMetadataJson || '{}')?.capabilities?.backup);
    } catch {
      /* unavailable */
    }
  }
  const tabs = (Object.keys(labels) as ServerPageTab[]).filter((key) => {
    if (key === 'console' || key === 'network' || key === 'containerconfig') return true;
    if (key === 'activity') return canLogs;
    if (key === 'backup') return hasBackup && access.canReadBackups;
    if (
      key === 'gameconfig' &&
      server.provider === 'external' &&
      !isNativeTemplate(server.providerMetadataJson)
    )
      return false;
    if (key === 'gameconfig')
      return (
        access.canUseGameConfigTab ||
        access.canUseMinecraft ||
        access.canUseHytale ||
        access.canUsePalworld ||
        access.canUseProjectZomboid ||
        access.canUseRust ||
        access.canUseValheim
      );
    return access.canAccessTab(key as SettingsTab);
  });
  const rows = ['tcp', 'udp'].flatMap((protocol) =>
    (server.portBindings?.[protocol as 'tcp' | 'udp'] || []).map((binding) => ({
      ...binding,
      protocol,
    }))
  );
  return (
    <div className="gp-server-page">
      <header className="gp-server-heading">
        <div className="gp-server-heading-main">
          <button className="gp-server-back" onClick={onBack}>
            <ArrowLeft size={17} /> Back to servers
          </button>
          <span className="gp-server-heading-divider" aria-hidden="true" />
          <div className="gp-server-identity">
            <div className="gp-server-titles">
              <h1>{server.name}</h1>
              {ACTIVE_SERVER?.displayId && (
                <small className="gp-server-display-id">{ACTIVE_SERVER.displayId}</small>
              )}
              <span className="gp-server-game">
                <span className="gp-server-title-separator" aria-hidden="true">
                  –
                </span>
                {gameDisplayName(gameName || server.game)}
              </span>
            </div>
            <span className={`gp-server-status ${status.className}`}>{status.label}</span>
          </div>
        </div>
        {allowed('server.power') && (
          <div className="gp-server-power">
            {currentUser?.isRoot && ACTIVE_SERVER && (
              <button onClick={() => setShowAccess(true)}>
                <Users size={16} /> Access
              </button>
            )}
            <button
              disabled={pending || !isServerDownLike(server.status)}
              onClick={() => void power('start')}
            >
              <Play size={16} /> Start
            </button>
            <button
              disabled={pending || !isServerUpLike(server.status)}
              onClick={() => setConfirm('restart')}
            >
              <RotateCw size={16} /> Restart
            </button>
            <button
              disabled={pending || !isServerUpLike(server.status)}
              onClick={() => setConfirm('stop')}
            >
              <Square size={16} /> Stop
            </button>
          </div>
        )}
      </header>
      {showAccess && currentUser?.isRoot && ACTIVE_SERVER && (
        <FleetAccess
          server={{
            id: ACTIVE_SERVER.id,
            name: server.name,
            node: { location: ACTIVE_SERVER.location },
          }}
          onClose={() => setShowAccess(false)}
        />
      )}
      {feedback && <p role="status">{feedback}</p>}
      <div className="gp-server-navigation">
        <nav className="gp-server-tabs" aria-label="Server sections">
          {tabs.map((key) => (
            <a
              key={key}
              href={serverPageHash({ node: ACTIVE_NODE, id: String(server.id), tab: key })}
              aria-current={tab === key ? 'page' : undefined}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onTab(key);
              }}
            >
              {labels[key]}
            </a>
          ))}
        </nav>
        {canLogs && tab !== 'console' && (
          <button
            className="gp-console-dock-toggle"
            aria-label={dockVisible ? 'Close side console' : 'Open side console'}
            title={dockVisible ? 'Close side console' : 'Open side console'}
            aria-expanded={dockVisible}
            aria-controls="server-side-console"
            onClick={() => setConsoleDockOpen((value) => !value)}
          >
            <Terminal size={20} />
          </button>
        )}
      </div>
      <div
        ref={workspaceRef}
        style={{ '--gp-dock-width': `${dockWidth}%` } as CSSProperties}
        className={`gp-server-workspace${dockVisible ? ' has-console-dock' : ''}${resizingDock ? ' is-resizing-dock' : ''}`}
      >
        <div className="gp-server-workspace-main">
          {tab === 'console' && (
            <>
              <div className={`gp-server-overview${tallConsole ? ' gp-server-overview-tall' : ''}`}>
                <section className="gp-server-console min-w-0" ref={consoleSectionRef}>
                  {canLogs ? (
                    consoleContent
                  ) : (
                    <div className="gp-server-stat">
                      You don't have permission to read the console.
                    </div>
                  )}
                </section>
                <aside className="gp-server-stats" aria-label="Server details">
                  <div className="gp-server-stat">
                    <Globe className="gp-stat-icon" size={19} aria-hidden="true" />
                    <small>Connection address</small>
                    <strong className="gp-server-address">{address}</strong>
                    {server.port && (
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(address).then(
                            () => setFeedback('Address copied.'),
                            () => setFeedback('Could not copy the address.')
                          );
                        }}
                        aria-label="Copy connection address"
                      >
                        <Copy size={16} />
                      </button>
                    )}
                  </div>
                  <div className="gp-server-stat">
                    <Cpu className="gp-stat-icon" size={19} aria-hidden="true" />
                    <small>CPU usage</small>
                    <strong>{formatMetricValue(server.status, server.cpuUsage)}</strong>
                  </div>
                  <div className="gp-server-stat">
                    <MemoryStick className="gp-stat-icon" size={19} aria-hidden="true" />
                    <small>Memory usage</small>
                    <strong>{formatMetricValue(server.status, server.memoryUsage)}</strong>
                  </div>
                  <div className="gp-server-stat">
                    <HardDrive className="gp-stat-icon" size={19} aria-hidden="true" />
                    <small>Disk usage</small>
                    <strong>{formatMetricValue(server.status, server.diskUsage)}</strong>
                  </div>
                  <div className="gp-server-stat">
                    <Network className="gp-stat-icon" size={19} aria-hidden="true" />
                    <small>Network · inbound / outbound</small>
                    <strong>
                      {formatNetworkSpeed(server.networkIn)} /{' '}
                      {formatNetworkSpeed(server.networkOut)}
                    </strong>
                  </div>
                </aside>
                <div className="gp-server-charts">
                  {(['cpuUsage', 'memoryUsage', 'networkIn'] as const).map((metric, index) => (
                    <section className="gp-server-stat" key={metric}>
                      <h2>{['CPU usage', 'Memory usage', 'Network traffic'][index]}</h2>
                      {metrics.length ? (
                        <div className="gp-server-chart-canvas">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={metrics.slice(-120)}>
                              <XAxis dataKey="timestamp" hide />
                              <YAxis
                                width={62}
                                tick={{ fontSize: 11, fill: 'var(--gp-muted)' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) =>
                                  index === 2 ? formatNetworkSpeed(Number(value)) : `${value}%`
                                }
                              />
                              <Tooltip
                                content={<MetricTooltip />}
                                cursor={{ stroke: 'var(--gp-muted)', strokeDasharray: '3 3' }}
                              />
                              <Area
                                type="monotone"
                                dataKey={metric}
                                stroke="#00c8e5"
                                fill="#00c8e5"
                                fillOpacity={0.12}
                                isAnimationActive={false}
                              />
                              {index === 2 && (
                                <Area
                                  dataKey="networkOut"
                                  stroke="#eab308"
                                  fillOpacity={0}
                                  isAnimationActive={false}
                                />
                              )}
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <p>Waiting for metric history…</p>
                      )}
                    </section>
                  ))}
                </div>
              </div>
            </>
          )}
          {settingsTab && (
            <ServerSettingsModal
              isOpen
              pageTab={tab as SettingsTab}
              onPageTabChange={onTab}
              onDirtyChange={onDirtyChange}
              onClose={onBack}
              serverName={server.name}
              serverGame={server.game}
              serverProvider={server.provider}
              serverProviderMetadataJson={server.providerMetadataJson}
              serverStatus={server.status}
              serverId={Number(server.id)}
              currentUser={currentUser}
              serverPermissions={permissions}
            />
          )}
          {tab === 'network' && (
            <section className="gp-server-stat">
              <h2>Network allocations</h2>
              <p>
                Public connection: <strong>{address}</strong>
              </p>
              <div className="overflow-x-auto">
                <table className="gp-server-network">
                  <thead>
                    <tr>
                      <th>Purpose</th>
                      <th>Protocol</th>
                      <th>Public address</th>
                      <th>Container port</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        <td>{row.label || 'Game server'}</td>
                        <td>{row.protocol.toUpperCase()}</td>
                        <td>
                          {row.hostIp || host}:{row.host}
                        </td>
                        <td>{row.container}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && <p>No additional port mappings available.</p>}
            </section>
          )}
          {tab === 'activity' && (
            <section className="gp-server-stat">
              <h2>Server activity</h2>
              <p>Runtime events received by this panel session.</p>
              {!canLogs ? (
                <p>No access to server activity.</p>
              ) : history.length ? (
                <ol className="gp-server-activity">
                  {[...history].reverse().map((entry) => (
                    <li key={entry.id}>
                      <time>{new Date(entry.timestamp).toLocaleString()}</time>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No events recorded yet.</p>
              )}
            </section>
          )}
        </div>
        {dockVisible && (
          <div
            className="gp-console-splitter"
            role="separator"
            tabIndex={0}
            aria-label="Resize side console"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={60}
            aria-valuenow={Math.round(dockWidth)}
            aria-controls="server-side-console"
            title="Drag to resize console. Double-click to reset."
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizingDock(true);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeDock(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              setResizingDock(false);
            }}
            onPointerCancel={() => setResizingDock(false)}
            onLostPointerCapture={() => setResizingDock(false)}
            onDoubleClick={() => setDockWidth(38)}
            onKeyDown={(event) => {
              const value =
                event.key === 'ArrowLeft'
                  ? dockWidth + 2
                  : event.key === 'ArrowRight'
                    ? dockWidth - 2
                    : event.key === 'Home'
                      ? 25
                      : event.key === 'End'
                        ? 60
                        : null;
              if (value === null) return;
              event.preventDefault();
              setDockWidth(Math.max(25, Math.min(60, value)));
            }}
          >
            <span />
          </div>
        )}
        {dockVisible && (
          <aside
            id="server-side-console"
            className="gp-console-dock"
            aria-label="Side server console"
          >
            {consoleContent}
          </aside>
        )}
      </div>
      <ConfirmationModal
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => power(confirm!)}
        title={`${confirm === 'stop' ? 'Stop' : 'Restart'} ${server.name}?`}
        message="This will interrupt connected players."
        confirmText={confirm === 'stop' ? 'Stop server' : 'Restart server'}
        icon="warning"
      />
    </div>
  );
}
