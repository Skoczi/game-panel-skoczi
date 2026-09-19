import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AppModal,
  AppModalContent,
  AppModalHeader,
  AppModalTitle,
  AppModalDescription,
  AppModalBody,
} from '../src/ui/components';
import { fleetContext, fleetRequest } from '../utils/fleetRuntime';
import {
  formatMetricTick,
  formatMetricTooltipLabel,
  formatNetworkSpeed,
} from './gameServersTable/utils';
import './fleet-detail-modals.css';

export type FleetMetricType = 'cpu' | 'memory' | 'disk' | 'network';
type Point = {
  timestamp: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  networkIn: number | null;
  networkOut: number | null;
};
const labels = {
  cpu: 'CPU',
  memory: 'Memory',
  disk: 'Disk',
  network: 'Network',
  networkIn: 'In',
  networkOut: 'Out',
};
const number = (value: unknown) =>
  value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
function normalize(raw: any): Point | null {
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.parse(raw.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  return {
    timestamp,
    cpu: number(raw.cpuUsage ?? raw.cpu_usage),
    memory: number(raw.memoryUsage ?? raw.memory_usage),
    disk: number(raw.diskUsage ?? raw.disk_usage),
    networkIn: number(raw.networkIn ?? raw.network_in ?? raw.network?.in),
    networkOut: number(raw.networkOut ?? raw.network_out ?? raw.network?.out),
  };
}

export function FleetMetricsModal({
  server,
  game,
  initialMetric,
  onClose,
}: {
  server: { id: string; name: string };
  game: string;
  initialMetric: FleetMetricType;
  onClose: () => void;
}) {
  const [metric, setMetric] = useState(initialMetric);
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    setPoints([]);
    setError('');
    const load = async () => {
      try {
        const context = await fleetContext(server.id);
        if (cancelled) return;
        const result = await fleetRequest<{ serverId: number; metrics: unknown[] }>(
          context,
          '/metrics?limit=2000'
        );
        if (cancelled) return;
        if (Number(result.serverId) !== context.runtimeId || !Array.isArray(result.metrics))
          throw new Error('Metrics response does not match this server.');
        setPoints(
          result.metrics
            .map(normalize)
            .filter((p): p is Point => p !== null)
            .sort((a, b) => a.timestamp - b.timestamp)
        );
        setError('');
      } catch (e) {
        if (!cancelled) {
          setPoints([]);
          setError(e instanceof Error ? e.message : 'Metrics unavailable');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(() => void load(), 15000);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [server.id, retry]);
  const hasData = points.some((p) =>
    metric === 'network' ? p.networkIn != null || p.networkOut != null : p[metric] != null
  );
  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AppModalContent className="gp-fleet fleet-detail-modal">
        <AppModalHeader>
          <AppModalTitle>Server Metrics</AppModalTitle>
          <AppModalDescription>
            {server.name} · {game}
          </AppModalDescription>
          <div className="fleet-metric-tabs" aria-label="Metric type">
            {(['cpu', 'memory', 'disk', 'network'] as const).map((type) => (
              <button key={type} aria-pressed={metric === type} onClick={() => setMetric(type)}>
                {labels[type]}
              </button>
            ))}
          </div>
        </AppModalHeader>
        <AppModalBody>
          {loading ? (
            <p role="status">Loading metrics history…</p>
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <button className="gp-fleet-button" onClick={() => setRetry((v) => v + 1)}>
                Retry
              </button>
            </div>
          ) : !hasData ? (
            <p className="fleet-detail-empty">No metrics history available yet for this server.</p>
          ) : (
            <div className="fleet-history-chart" aria-label={`${labels[metric]} history chart`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--fleet-border)" />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={formatMetricTick}
                    minTickGap={32}
                    stroke="var(--fleet-muted)"
                    fontSize={11}
                  />
                  <YAxis
                    width={65}
                    domain={
                      metric === 'network' ? [0, 'auto'] : [0, (max: number) => Math.max(100, max)]
                    }
                    tickFormatter={(v) => (metric === 'network' ? formatNetworkSpeed(v) : `${v}%`)}
                    stroke="var(--fleet-muted)"
                    fontSize={11}
                  />
                  <Tooltip
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div className="fleet-history-tooltip">
                          <time>{formatMetricTooltipLabel(label)}</time>
                          {payload.map((entry) => (
                            <div key={entry.dataKey}>
                              <span style={{ color: entry.color }}>●</span>{' '}
                              {labels[entry.dataKey as keyof typeof labels]}{' '}
                              <strong>
                                {metric === 'network'
                                  ? formatNetworkSpeed(Number(entry.value))
                                  : `${Number(entry.value).toFixed(2)}%`}
                              </strong>
                            </div>
                          ))}
                        </div>
                      ) : null
                    }
                  />
                  {metric === 'network' && (
                    <Legend formatter={(key) => labels[key as keyof typeof labels]} />
                  )}
                  {(metric === 'network' ? ['networkIn', 'networkOut'] : [metric]).map((key) => (
                    <Area
                      key={key}
                      dataKey={key}
                      type="monotone"
                      stroke={key === 'networkOut' ? '#a78bfa' : '#06b6d4'}
                      fill={key === 'networkOut' ? '#a78bfa' : '#06b6d4'}
                      fillOpacity={0.13}
                      strokeWidth={1.8}
                      dot={points.length === 1}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </AppModalBody>
      </AppModalContent>
    </AppModal>
  );
}
