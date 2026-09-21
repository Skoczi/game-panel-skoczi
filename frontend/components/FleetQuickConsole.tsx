import { useEffect, useState } from 'react';
import { RefreshCw, Terminal } from 'lucide-react';
import { ServerConsoleTabs } from './ServerConsoleTabs';
import { RealtimeGateway } from '../utils/api/realtimeGateway';
import { getStoredToken } from '../utils/api/runtime';
import { extractTimestampedLogLine, type ServerLogs } from '../utils/serverRuntime';
import {
  fleetAllowed,
  fleetContext,
  fleetRequest,
  fleetSocketUrl,
  loadFleetRuntime,
  type FleetRuntime,
} from '../utils/fleetRuntime';

export function FleetQuickConsole({
  tabs,
  active,
  onActive,
  onClose,
}: {
  tabs: { id: string; displayId?: string; name: string; node: { name: string } }[];
  active: string;
  onActive: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const [logs, setLogs] = useState<ServerLogs>({});
  const [runtimes, setRuntimes] = useState<Record<string, FleetRuntime>>({});
  const [status, setStatus] = useState('Connecting…');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let gateway: RealtimeGateway | undefined;
    let serial = Date.now();
    setReady(false);
    setStatus('Connecting…');
    const clear = () => setLogs((previous) => ({ ...previous, [active]: [] }));
    clear();
    void loadFleetRuntime(active)
      .then((runtime) => {
        if (cancelled) return;
        if (!fleetAllowed(runtime.context, 'container.logs.read'))
          throw new Error('You do not have console access for this server.');
        setRuntimes((previous) => ({ ...previous, [active]: runtime }));
        gateway = new RealtimeGateway(getStoredToken, fleetSocketUrl(runtime.context));
        gateway.onStatusChange((state) => {
          if (cancelled) return;
          if (state !== 'open') {
            setReady(false);
            setStatus(state === 'closed' ? 'Disconnected' : 'Connecting…');
          }
        });
        gateway.subscribeLogs(runtime.context.runtimeId, 300);
        return gateway.connect((message) => {
          if (cancelled) return;
          if (message.type === 'error' || message.type === 'auth:error') {
            setReady(false);
            setStatus('Console unavailable. Retry or check server access.');
            clear();
            gateway?.close();
            return;
          }
          if (message.type === 'auth:ok' || message.type === 'auth:success') {
            setReady(true);
            setStatus('Live');
          }
          if (Number(message.serverId) !== runtime.context.runtimeId) return;
          if (
            !['logs:history', 'logs:container', 'logs:new', 'logs:container:new'].includes(
              message.type
            )
          )
            return;
          const raw = message.lines || message.logs;
          if (!Array.isArray(raw)) return;
          const entries = raw.map((line) => ({
            ...extractTimestampedLogLine(line),
            id: ++serial,
            type: 'info' as const,
          }));
          setLogs((previous) => ({
            ...previous,
            [active]: (message.type === 'logs:history' || message.type === 'logs:container'
              ? entries
              : [...(previous[active] || []), ...entries]
            ).slice(-1500),
          }));
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error.message || 'Console unavailable');
          setReady(false);
          clear();
        }
      });
    return () => {
      cancelled = true;
      gateway?.close();
    };
  }, [active, retry]);
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    setLogs((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id)))
    );
    setRuntimes((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id)))
    );
  }, [tabs]);
  const runtime = runtimes[active];
  return (
    <section className="gp-fleet-quick-console" aria-label="Quick server console">
      <div className="gp-fleet-console-heading">
        <div>
          <Terminal size={18} />
          <strong>Quick console</strong>
        </div>
        <div>
          <span role="status" className={ready ? 'is-live' : ''}>
            {status}
          </span>
          <button
            className="gp-fleet-button"
            onClick={() => setRetry((v) => v + 1)}
            aria-label="Reconnect console"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      <ServerConsoleTabs
        hideActivity
        servers={tabs.map((t) => ({
          ...(runtimes[t.id]?.server || { id: t.id, game: '', status: 'stopped' as const }),
          name: `${t.displayId ? `${t.displayId} · ` : ''}${t.name} · ${t.node.name}`,
        }))}
        logs={logs}
        cliMessages={[]}
        openTabs={tabs.map((t) => t.id)}
        activeTab={active}
        onSetActiveTab={(id) => {
          if (tabs.some((t) => t.id === id)) onActive(id);
        }}
        onCloseTab={onClose}
        onClearCLI={() => {}}
        onClearLogs={(id) => setLogs((previous) => ({ ...previous, [id]: [] }))}
        canSendCommandByServer={{
          [active]:
            ready && Boolean(runtime && fleetAllowed(runtime.context, 'server.command.send')),
        }}
        onSendCommand={async (id, command) => {
          if (id !== active || !ready) throw new Error('Console is not connected');
          const context = await fleetContext(id);
          if (!fleetAllowed(context, 'server.command.send'))
            throw new Error('Command access denied');
          if (
            !runtime ||
            context.nodeId !== runtime.context.nodeId ||
            context.runtimeId !== runtime.context.runtimeId ||
            context.placementRevision !== runtime.context.placementRevision
          )
            throw new Error('Server moved. Reconnect the console.');
          await fleetRequest(context, '/console/commands', { command });
        }}
      />
    </section>
  );
}
