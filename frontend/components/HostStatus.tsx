import {
  startTransition,
  useDeferredValue,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { RealtimeGateway } from '../utils/api/realtimeGateway';
import { getStoredToken } from '../utils/api/runtime';
import { AppButton } from '../src/ui/components';
import { HostStatusView } from './hostStatus/HostStatusView';
import { ODS_CHART_THEME } from './charts/theme';

interface SystemMetrics {
  cpu: number;
  memory: number;
  cpuUsage?: number;
  memoryUsage?: number;
  disk?: number;
  diskUsage?: number;
  disk_usage?: number;
  network_in: number;
  network_out: number;
  network?: { in?: number; out?: number };
  timestamp?: number | string;
}

type UsagePoint = { time: string; timestamp: number; value: number };
type NetworkPoint = { time: string; timestamp: number; in: number; out: number };

const chartTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const timelineTickSameDayFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const timelineTickFullFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function HostStatus({
  nodeId = 'local',
  compact = false,
}: {
  nodeId?: string;
  compact?: boolean;
}) {
  const [connection, setConnection] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [retry, setRetry] = useState(0);
  const [cpuUsage, setCpuUsage] = useState(0);
  const [ramUsage, setRamUsage] = useState(0);
  const [diskUsage, setDiskUsage] = useState(0);
  const [networkIn, setNetworkIn] = useState(0);
  const [networkOut, setNetworkOut] = useState(0);
  const [cpuHistory, setCpuHistory] = useState<UsagePoint[]>([]);
  const [ramHistory, setRamHistory] = useState<UsagePoint[]>([]);
  const [diskHistory, setDiskHistory] = useState<UsagePoint[]>([]);
  const [networkHistory, setNetworkHistory] = useState<NetworkPoint[]>([]);
  const [sharedZoom, setSharedZoom] = useState(100);
  const [sharedOffset, setSharedOffset] = useState(0);
  const [selectedTimeRange, setSelectedTimeRange] = useState<'1h' | '3h' | '6h' | '12h' | '24h'>(
    '24h'
  );

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const cpuHistoryRef = useRef<UsagePoint[]>([]);
  const ramHistoryRef = useRef<UsagePoint[]>([]);
  const diskHistoryRef = useRef<UsagePoint[]>([]);
  const networkHistoryRef = useRef<NetworkPoint[]>([]);
  const historyRequestLimit = 2000;
  const metricsGapThresholdMs = 60 * 60 * 1000;
  const maxTimelineDurationMs = 24 * 60 * 60 * 1000;

  const bytesPerSecondToKilobytes = (bytesPerSec: number): number => {
    return bytesPerSec / 1024;
  };

  const formatSpeed = (kilobytesPerSecond: number): { value: number; unit: string } => {
    if (kilobytesPerSecond >= 1024 * 1024) {
      return {
        value: Math.round((kilobytesPerSecond / (1024 * 1024)) * 100) / 100,
        unit: 'GB/s',
      };
    } else if (kilobytesPerSecond >= 1024) {
      return { value: Math.round((kilobytesPerSecond / 1024) * 100) / 100, unit: 'MB/s' };
    } else {
      return { value: Math.round(kilobytesPerSecond * 100) / 100, unit: 'KB/s' };
    }
  };

  const formatNetworkTick = (value: number): string => {
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(0)}G`;
    } else if (value >= 1024) {
      return `${(value / 1024).toFixed(0)}M`;
    } else {
      return `${value.toFixed(0)}K`;
    }
  };

  const calculateYDomain = (data: Array<{ value: number | null }>) => {
    if (!data || data.length === 0) return [0, 100];

    const values = data
      .map((d) => d.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) return [0, 100];

    const min = Math.min(...values);
    const max = Math.max(...values);

    const range = max - min || 10;
    const margin = Math.max(range * 0.15, 5);

    const yMin = Math.max(0, Math.floor(min - margin));
    let yMax = Math.ceil(max + margin);

    yMax = Math.ceil(yMax / 10) * 10;

    yMax = Math.min(100, yMax);

    return [yMin, yMax];
  };

  const calculateNetworkYDomain = (data: Array<{ in: number | null; out: number | null }>) => {
    if (!data || data.length === 0) return [0, 1024];

    const allValues = data
      .flatMap((d) => [d.in, d.out])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (allValues.length === 0) return [0, 1024];

    const max = Math.max(...allValues);

    const yMax = Math.ceil(max * 1.2);

    return [0, yMax];
  };

  const formatPercentTick = (value: number): string => {
    return `${Math.round(value)}%`;
  };

  const toEpochMs = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 1e12) return value; // Milliseconds epoch.
      if (value > 1e9) return value * 1000; // Seconds epoch.
      return null;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }

    return null;
  };

  const getMetricEpochMs = (metric: any): number => {
    const rawTime =
      metric?.timestamp ??
      metric?.date ??
      metric?.datetime ??
      metric?.recorded_at ??
      metric?.created_at;

    const parsed = toEpochMs(rawTime);
    return parsed ?? Date.now();
  };

  const estimateStepMs = <T extends { timestamp: number }>(data: T[]): number => {
    if (data.length < 2) return 60 * 1000;

    const sampleStartIndex = Math.max(1, data.length - 120);
    let totalDelta = 0;
    let deltaCount = 0;

    for (let i = sampleStartIndex; i < data.length; i += 1) {
      const delta = data[i].timestamp - data[i - 1].timestamp;
      if (delta > 0 && delta < metricsGapThresholdMs * 2) {
        totalDelta += delta;
        deltaCount += 1;
      }
    }

    if (deltaCount === 0) return 60 * 1000;
    return totalDelta / deltaCount;
  };

  const getZoomedData = <T extends { timestamp: number }>(
    data: T[],
    zoomLevel: number,
    offset: number
  ): T[] => {
    if (!data || data.length === 0) return data;

    const earliestTimestamp = data[0].timestamp;
    const latestTimestamp = data[data.length - 1].timestamp;
    const timelineEndMs = Math.max(Date.now(), latestTimestamp);
    const visibleWindowMs = Math.max(
      15 * 60 * 1000,
      Math.round(maxTimelineDurationMs * (zoomLevel / 100))
    );
    const averageStepMs = estimateStepMs(data);
    const requestedOffsetMs = Math.max(0, offset) * averageStepMs;

    const availableRangeMs = Math.max(0, timelineEndMs - earliestTimestamp);
    const maxOffsetMs = Math.max(0, availableRangeMs - visibleWindowMs);
    const safeOffsetMs = Math.min(requestedOffsetMs, maxOffsetMs);

    const endTimestamp = timelineEndMs - safeOffsetMs;
    const startTimestamp = Math.max(earliestTimestamp, endTimestamp - visibleWindowMs);
    const zoomed = data.filter(
      (point) => point.timestamp >= startTimestamp && point.timestamp <= endTimestamp
    );

    if (zoomed.length > 1) return zoomed;

    const fallbackItemsToShow = Math.max(2, Math.ceil((data.length * zoomLevel) / 100));
    return data.slice(Math.max(0, data.length - fallbackItemsToShow));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const delta = e.clientX - dragStart;
    const dragSensitivityPx = 2;
    const offsetDelta = Math.floor(delta / dragSensitivityPx);

    if (Math.abs(offsetDelta) < 1) return;

    setDragStart(e.clientX);

    setSharedOffset((prev) => Math.max(0, prev + offsetDelta));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleSetTimeRange = useCallback((range: '1h' | '3h' | '6h' | '12h' | '24h') => {
    const zoom = (parseInt(range) / 24) * 100;
    setSelectedTimeRange(range);
    setSharedZoom(zoom);
    setSharedOffset(0);
  }, []);

  const handleChartWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const zoomDelta = event.deltaY > 0 ? 10 : -10;
    setSharedZoom((currentZoom) => Math.max(10, Math.min(100, currentZoom + zoomDelta)));
  }, []);

  const formatTime = (timestamp: any): string => {
    try {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return chartTimeFormatter.format(date);
      }
      return 'N/A';
    } catch {
      return 'N/A';
    }
  };

  const formatTimelineTick = (timestamp: number): string => {
    if (!Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();

    return sameDay
      ? timelineTickSameDayFormatter.format(date)
      : timelineTickFullFormatter.format(date);
  };

  const formatTooltipTime = (label: unknown): string => {
    if (typeof label === 'number' && Number.isFinite(label)) return formatTime(label);
    const numeric = Number(label);
    if (Number.isFinite(numeric)) return formatTime(numeric);
    return 'N/A';
  };

  const dedupeByTimestamp = <T extends { timestamp: number }>(points: T[]): T[] => {
    if (points.length <= 1) return points;
    const next: T[] = [];
    for (const point of points) {
      const last = next[next.length - 1];
      if (last && Math.abs(last.timestamp - point.timestamp) < 1000) {
        next[next.length - 1] = point;
      } else {
        next.push(point);
      }
    }
    return next;
  };

  const clampHistoryWindow = <T extends { timestamp: number }>(
    points: T[],
    referenceMs: number
  ): T[] => {
    const minTimestamp = referenceMs - maxTimelineDurationMs;
    const maxTimestamp = referenceMs + 60_000;
    return points.filter(
      (point) => point.timestamp >= minTimestamp && point.timestamp <= maxTimestamp
    );
  };

  const normalizeUsageHistory = (points: UsagePoint[], referenceMs: number): UsagePoint[] => {
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    return clampHistoryWindow(dedupeByTimestamp(sorted), referenceMs);
  };

  const normalizeNetworkHistory = (points: NetworkPoint[], referenceMs: number): NetworkPoint[] => {
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    return clampHistoryWindow(dedupeByTimestamp(sorted), referenceMs);
  };

  const appendUsageHistory = (
    previous: UsagePoint[],
    nextPoint: UsagePoint,
    referenceMs: number
  ) => {
    const last = previous[previous.length - 1];
    if (!last) return clampHistoryWindow([nextPoint], referenceMs);

    if (nextPoint.timestamp < last.timestamp - 1000) {
      return normalizeUsageHistory([...previous, nextPoint], referenceMs);
    }

    if (Math.abs(last.timestamp - nextPoint.timestamp) < 1000) {
      if (last.value === nextPoint.value && last.time === nextPoint.time) {
        return previous;
      }

      return clampHistoryWindow([...previous.slice(0, -1), nextPoint], referenceMs);
    }

    return clampHistoryWindow([...previous, nextPoint], referenceMs);
  };

  const appendNetworkHistory = (
    previous: NetworkPoint[],
    nextPoint: NetworkPoint,
    referenceMs: number
  ) => {
    const last = previous[previous.length - 1];
    if (!last) return clampHistoryWindow([nextPoint], referenceMs);

    if (nextPoint.timestamp < last.timestamp - 1000) {
      return normalizeNetworkHistory([...previous, nextPoint], referenceMs);
    }

    if (Math.abs(last.timestamp - nextPoint.timestamp) < 1000) {
      if (last.in === nextPoint.in && last.out === nextPoint.out && last.time === nextPoint.time) {
        return previous;
      }

      return clampHistoryWindow([...previous.slice(0, -1), nextPoint], referenceMs);
    }

    return clampHistoryWindow([...previous, nextPoint], referenceMs);
  };

  useEffect(() => {
    cpuHistoryRef.current = cpuHistory;
  }, [cpuHistory]);

  useEffect(() => {
    ramHistoryRef.current = ramHistory;
  }, [ramHistory]);

  useEffect(() => {
    diskHistoryRef.current = diskHistory;
  }, [diskHistory]);

  useEffect(() => {
    networkHistoryRef.current = networkHistory;
  }, [networkHistory]);

  const handleSystemMetrics = useCallback((metrics: SystemMetrics) => {
    const cpu = metrics.cpu ?? (metrics as any).cpu_usage ?? metrics.cpuUsage ?? 0;
    const memory = metrics.memory ?? (metrics as any).memory_usage ?? metrics.memoryUsage ?? 0;
    const disk = metrics.disk ?? (metrics as any).disk_usage ?? metrics.diskUsage ?? 0;

    const cpuValue = cpu > 100 ? cpu / 100 : cpu;
    const memoryValue = memory > 100 ? memory / 100 : memory;
    const diskValue = disk > 100 ? disk / 100 : disk;
    const diskPercent = Math.round(Math.min(diskValue, 100) * 100) / 100;

    setCpuUsage(Math.round(Math.min(cpuValue, 100) * 100) / 100);
    setRamUsage(Math.round(Math.min(memoryValue, 100) * 100) / 100);
    setDiskUsage(diskPercent);

    const networkIn = metrics.network_in ?? (metrics as any).network?.in ?? 0;
    const networkOut = metrics.network_out ?? (metrics as any).network?.out ?? 0;

    const newNetworkIn = bytesPerSecondToKilobytes(networkIn);
    const newNetworkOut = bytesPerSecondToKilobytes(networkOut);

    setNetworkIn(newNetworkIn);
    setNetworkOut(newNetworkOut);

    const metricEpochMs = getMetricEpochMs(metrics);
    const now = new Date(metricEpochMs);
    const timeStr = chartTimeFormatter.format(now);

    const nextCpuHistory = appendUsageHistory(
      cpuHistoryRef.current,
      { time: timeStr, timestamp: metricEpochMs, value: cpu },
      metricEpochMs
    );
    const nextRamHistory = appendUsageHistory(
      ramHistoryRef.current,
      { time: timeStr, timestamp: metricEpochMs, value: memory },
      metricEpochMs
    );
    const nextDiskHistory = appendUsageHistory(
      diskHistoryRef.current,
      { time: timeStr, timestamp: metricEpochMs, value: diskPercent },
      metricEpochMs
    );
    const nextNetworkHistory = appendNetworkHistory(
      networkHistoryRef.current,
      { time: timeStr, timestamp: metricEpochMs, in: newNetworkIn, out: newNetworkOut },
      metricEpochMs
    );

    startTransition(() => {
      if (nextCpuHistory !== cpuHistoryRef.current) {
        cpuHistoryRef.current = nextCpuHistory;
        setCpuHistory(nextCpuHistory);
      }
      if (nextRamHistory !== ramHistoryRef.current) {
        ramHistoryRef.current = nextRamHistory;
        setRamHistory(nextRamHistory);
      }
      if (nextDiskHistory !== diskHistoryRef.current) {
        diskHistoryRef.current = nextDiskHistory;
        setDiskHistory(nextDiskHistory);
      }
      if (nextNetworkHistory !== networkHistoryRef.current) {
        networkHistoryRef.current = nextNetworkHistory;
        setNetworkHistory(nextNetworkHistory);
      }
    });
  }, []);

  useEffect(() => {
    let active = true;
    let lastSampleAt = 0;
    setConnection('loading');
    const path = nodeId === 'local' ? '/api' : `/api/nodes/${encodeURIComponent(nodeId)}/ws`;
    const gateway = new RealtimeGateway(
      getStoredToken,
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${path}`
    );
    const normalize = (raw: any, timestamp?: string) => {
      if (!raw || typeof raw !== 'object') return null;
      const metric = {
        ...raw,
        cpu: raw.cpu ?? raw.cpu_usage ?? raw.cpuUsage,
        memory: raw.memory ?? raw.memory_usage ?? raw.memoryUsage,
        disk: raw.disk ?? raw.disk_usage ?? raw.diskUsage,
        network_in: raw.network_in ?? raw.network?.in,
        network_out: raw.network_out ?? raw.network?.out,
        timestamp:
          timestamp ??
          raw.timestamp ??
          raw.date ??
          raw.datetime ??
          raw.recorded_at ??
          raw.created_at,
      };
      return [metric.cpu, metric.memory, metric.disk, metric.network_in, metric.network_out].every(
        (value) => typeof value === 'number' && Number.isFinite(value)
      )
        ? metric
        : null;
    };
    const markFresh = (metric: SystemMetrics) => {
      // Historical samples never masquerade as a live, healthy host.
      if (
        toEpochMs(metric.timestamp) !== null &&
        Math.abs(Date.now() - getMetricEpochMs(metric)) < 60000
      ) {
        lastSampleAt = Date.now();
        setConnection('ready');
      }
    };
    const stopStatus = gateway.onStatusChange((status) => {
      if (active && (status === 'closed' || status === 'reconnecting')) {
        lastSampleAt = 0;
        setConnection('unavailable');
      }
    });
    setConnection('loading');
    const watchdog = window.setInterval(() => {
      if (active && Date.now() - lastSampleAt > 30000) setConnection('unavailable');
    }, 10000);

    const handleMetricsEvent = (message: any) => {
      if (!active) return;
      if (message.type === 'error') {
        setConnection('unavailable');
        return;
      }
      if (message.type === 'system-metrics:update' || message.type === 'system-metrics') {
        const metric = normalize(message.metrics || message, message.timestamp);
        if (metric) {
          handleSystemMetrics(metric);
          markFresh(metric);
        }
      }
      if (message.type === 'system-metrics:history') {
        const history = Array.isArray(message.metrics)
          ? message.metrics.map((raw: any) => normalize(raw)).filter(Boolean)
          : [];
        if (history.length > 0) {
          const sortedHistory = [...history].sort(
            (a: any, b: any) => getMetricEpochMs(a) - getMetricEpochMs(b)
          );
          const latest = sortedHistory[sortedHistory.length - 1];

          const nextCpu = sortedHistory.map((m: any) => ({
            time: formatTime(getMetricEpochMs(m)),
            timestamp: getMetricEpochMs(m),
            value: Math.round((m.cpu_usage || m.cpu || 0) * 100) / 100,
          }));

          const nextRam = sortedHistory.map((m: any) => ({
            time: formatTime(getMetricEpochMs(m)),
            timestamp: getMetricEpochMs(m),
            value: Math.round((m.memory_usage || m.memory || 0) * 100) / 100,
          }));

          const nextDisk = sortedHistory.map((m: any) => {
            const disk = m.disk_usage ?? m.disk ?? m.diskUsage ?? 0;
            const diskValue = disk > 100 ? disk / 100 : disk;
            return {
              time: formatTime(getMetricEpochMs(m)),
              timestamp: getMetricEpochMs(m),
              value: Math.round(Math.min(diskValue, 100) * 100) / 100,
            };
          });

          const nextNet = sortedHistory.map((m: any) => ({
            time: formatTime(getMetricEpochMs(m)),
            timestamp: getMetricEpochMs(m),
            in: bytesPerSecondToKilobytes(m.network_in || 0),
            out: bytesPerSecondToKilobytes(m.network_out || 0),
          }));

          const referenceMs = getMetricEpochMs(latest);
          const normalizedCpu = normalizeUsageHistory(nextCpu, referenceMs);
          const normalizedRam = normalizeUsageHistory(nextRam, referenceMs);
          const normalizedDisk = normalizeUsageHistory(nextDisk, referenceMs);
          const normalizedNet = normalizeNetworkHistory(nextNet, referenceMs);

          startTransition(() => {
            cpuHistoryRef.current = normalizedCpu;
            ramHistoryRef.current = normalizedRam;
            diskHistoryRef.current = normalizedDisk;
            networkHistoryRef.current = normalizedNet;
            setCpuHistory(normalizedCpu);
            setRamHistory(normalizedRam);
            setDiskHistory(normalizedDisk);
            setNetworkHistory(normalizedNet);
          });

          if (latest) {
            markFresh(latest);
            const cpu = latest.cpu_usage || latest.cpu || 0;
            const memory = latest.memory_usage || latest.memory || 0;
            const disk = latest.disk_usage ?? latest.disk ?? latest.diskUsage ?? 0;

            const cpuValue = cpu > 100 ? cpu / 100 : cpu;
            const memoryValue = memory > 100 ? memory / 100 : memory;
            const diskValue = disk > 100 ? disk / 100 : disk;

            setCpuUsage(Math.round(Math.min(cpuValue, 100) * 100) / 100);
            setRamUsage(Math.round(Math.min(memoryValue, 100) * 100) / 100);
            setDiskUsage(Math.round(Math.min(diskValue, 100) * 100) / 100);
            setNetworkIn(bytesPerSecondToKilobytes(latest.network_in || 0));
            setNetworkOut(bytesPerSecondToKilobytes(latest.network_out || 0));
          }
        }
      }
    };

    gateway.subscribeSystemMetrics(compact ? 1 : historyRequestLimit);
    void gateway.connect(handleMetricsEvent).catch(() => {
      if (active) setConnection('unavailable');
    });
    return () => {
      active = false;
      window.clearInterval(watchdog);
      stopStatus();
      gateway.close();
      gateway.resetState();
    };
  }, [handleSystemMetrics, nodeId, compact, retry]);

  const diskUsagePercent = Math.max(0, Math.min(100, Math.round(diskUsage * 100) / 100));
  const deferredCpuHistory = useDeferredValue(cpuHistory);
  const deferredRamHistory = useDeferredValue(ramHistory);
  const deferredDiskHistory = useDeferredValue(diskHistory);
  const deferredNetworkHistory = useDeferredValue(networkHistory);

  const zoomedCpuHistory = useMemo(
    () => getZoomedData(deferredCpuHistory, sharedZoom, sharedOffset),
    [deferredCpuHistory, sharedZoom, sharedOffset]
  );
  const zoomedRamHistory = useMemo(
    () => getZoomedData(deferredRamHistory, sharedZoom, sharedOffset),
    [deferredRamHistory, sharedZoom, sharedOffset]
  );
  const zoomedDiskHistory = useMemo(
    () => getZoomedData(deferredDiskHistory, sharedZoom, sharedOffset),
    [deferredDiskHistory, sharedZoom, sharedOffset]
  );
  const zoomedNetworkHistory = useMemo(
    () => getZoomedData(deferredNetworkHistory, sharedZoom, sharedOffset),
    [deferredNetworkHistory, sharedZoom, sharedOffset]
  );

  const cpuChartData = useMemo(() => zoomedCpuHistory, [zoomedCpuHistory]);
  const ramChartData = useMemo(() => zoomedRamHistory, [zoomedRamHistory]);
  const diskChartData = useMemo(() => zoomedDiskHistory, [zoomedDiskHistory]);
  const networkChartData = useMemo(() => zoomedNetworkHistory, [zoomedNetworkHistory]);
  const networkInSpeed = formatSpeed(networkIn);
  const networkOutSpeed = formatSpeed(networkOut);
  const historyChartHeight = 250;

  const cardBg = 'bg-gp-surface-card';
  const cardBorder = 'border-gray-800';
  const cardShadow = 'shadow-[0_4px_20px_rgba(2,6,23,0.5),0_1px_4px_rgba(2,6,23,0.3)]';
  const textPrimary = 'text-white';
  const textSecondary = 'text-gray-400';
  const progressBg = 'bg-gray-700';
  const chartGridColor = ODS_CHART_THEME.grid;
  const chartAxisColor = ODS_CHART_THEME.axis;
  const chartTooltipBg = ODS_CHART_THEME.tooltipBg;
  const chartTooltipBorder = ODS_CHART_THEME.tooltipBorder;

  if (connection !== 'ready')
    return (
      <div role="status" className="rounded-lg border border-gray-500/20 p-5 text-sm text-gray-400">
        {connection === 'loading'
          ? 'Loading host metrics…'
          : 'Host metrics unavailable. Reconnecting…'}
        {connection === 'unavailable' && (
          <AppButton tone="ghost" className="ml-3 px-3" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </AppButton>
        )}
      </div>
    );
  return (
    <HostStatusView
      compact={compact}
      cpuUsage={cpuUsage}
      ramUsage={ramUsage}
      diskUsagePercent={diskUsagePercent}
      networkInSpeed={networkInSpeed}
      networkOutSpeed={networkOutSpeed}
      cpuChartData={cpuChartData}
      ramChartData={ramChartData}
      diskChartData={diskChartData}
      networkChartData={networkChartData}
      zoomedCpuHistory={zoomedCpuHistory}
      zoomedRamHistory={zoomedRamHistory}
      zoomedDiskHistory={zoomedDiskHistory}
      zoomedNetworkHistory={zoomedNetworkHistory}
      isDragging={isDragging}
      historyChartHeight={historyChartHeight}
      cardBg={cardBg}
      cardBorder={cardBorder}
      cardShadow={cardShadow}
      textPrimary={textPrimary}
      textSecondary={textSecondary}
      progressBg={progressBg}
      chartGridColor={chartGridColor}
      chartAxisColor={chartAxisColor}
      chartTooltipBg={chartTooltipBg}
      chartTooltipBorder={chartTooltipBorder}
      selectedTimeRange={selectedTimeRange}
      onSetTimeRange={handleSetTimeRange}
      handleMouseDown={handleMouseDown}
      handleMouseMove={handleMouseMove}
      handleMouseUp={handleMouseUp}
      handleChartWheel={handleChartWheel}
      formatTimelineTick={formatTimelineTick}
      formatTooltipTime={formatTooltipTime}
      calculateYDomain={calculateYDomain}
      calculateNetworkYDomain={calculateNetworkYDomain}
      formatPercentTick={formatPercentTick}
      formatNetworkTick={formatNetworkTick}
      formatSpeed={formatSpeed}
    />
  );
}
