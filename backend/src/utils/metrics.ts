import type { ServerMetricRow, SystemMetricRow } from '../types/database.js';
import { round2 } from './number.js';
import { toIsoTimestamp } from './time.js';

type MetricRow = Record<string, any> & {
    timestamp?: string;
    ts?: number;
};

export type MetricSample = {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
    network: {
        in: number;
        out: number;
    };
};

export type SerializedMetricPoint = MetricSample & {
    timestamp: string;
};

export type MetricsHistoryMeta = {
    window: '24h';
    downsample: string;
    rawCount: number;
    sentCount: number;
};

export const METRICS_HISTORY_RAW_LIMIT = 10_000;

const METRICS_HISTORY_WINDOW = '24h' as const;
const METRICS_HISTORY_DOWNSAMPLE = '0-1h:10s,1-6h:30s,6-24h:120s';

const METRIC_NUMERIC_KEYS = [
    'cpu_usage',
    'memory_usage',
    'disk_usage',
    'network_in',
    'network_out',
];

function parseTimestampToMs(ts: string): number {
    const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}

function bucketSizeMsForAge(ageMs: number): number {
    const hourMs = 60 * 60_000;
    if (ageMs <= 1 * hourMs) return 10_000;
    if (ageMs <= 6 * hourMs) return 30_000;
    return 120_000;
}

export function downsampleMetrics<T extends MetricRow>(
    rowsChronological: T[],
    nowMs: number,
    numericKeys: string[],
): T[] {
    const buckets = new Map<number, {
        row: any;
        count: number;
        sums: Record<string, number>;
    }>();

    for (const row of rowsChronological) {
        const timestampMs = typeof row.ts === 'number'
            ? row.ts
            : (row.timestamp ? parseTimestampToMs(row.timestamp) : 0);
        if (!timestampMs) continue;

        const ageMs = nowMs - timestampMs;
        if (ageMs < 0 || ageMs > 24 * 60 * 60_000) continue;

        const bucketMs = bucketSizeMsForAge(ageMs);
        const bucketStart = Math.floor(timestampMs / bucketMs) * bucketMs;

        let bucket = buckets.get(bucketStart);
        if (!bucket) {
            const base: any = { ...row };
            base.timestamp = new Date(bucketStart).toISOString();
            base.ts = bucketStart;

            bucket = {
                row: base,
                count: 0,
                sums: Object.fromEntries(numericKeys.map((key) => [key, 0])),
            };
            buckets.set(bucketStart, bucket);
        }

        bucket.count += 1;
        for (const key of numericKeys) {
            const value = Number((row as any)[key]);
            if (Number.isFinite(value)) bucket.sums[key] += value;
        }
    }

    return Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, bucket]) => {
            const out = { ...bucket.row };
            for (const key of numericKeys) {
                out[key] = round2(bucket.count > 0 ? bucket.sums[key] / bucket.count : out[key]);
            }
            delete (out as any).ts;
            return out as T;
        });
}

export function serializeMetricPoint(row: Pick<
    ServerMetricRow | SystemMetricRow,
    'cpu_usage' | 'memory_usage' | 'disk_usage' | 'network_in' | 'network_out' | 'timestamp'
>): SerializedMetricPoint {
    return {
        cpuUsage: round2(Number(row.cpu_usage)),
        memoryUsage: round2(Number(row.memory_usage)),
        diskUsage: round2(Number(row.disk_usage)),
        network: {
            in: Math.max(0, Math.round(Number(row.network_in) || 0)),
            out: Math.max(0, Math.round(Number(row.network_out) || 0)),
        },
        timestamp: toIsoTimestamp(row.timestamp),
    };
}

export function buildMetricsHistory(
    rowsNewestFirst: Array<ServerMetricRow | SystemMetricRow>,
    limit: number,
): { points: SerializedMetricPoint[]; meta: MetricsHistoryMeta } {
    const chronological = [...rowsNewestFirst].reverse();
    const downsampled = downsampleMetrics(chronological, Date.now(), METRIC_NUMERIC_KEYS);

    const capped = downsampled.length > limit
        ? downsampled.slice(downsampled.length - limit)
        : downsampled;
    const points = capped.map(serializeMetricPoint);

    return {
        points,
        meta: {
            window: METRICS_HISTORY_WINDOW,
            downsample: METRICS_HISTORY_DOWNSAMPLE,
            rawCount: rowsNewestFirst.length,
            sentCount: points.length,
        },
    };
}
