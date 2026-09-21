import type { MetricSample } from './metrics.js';

export type ServerMetricsSample = { serverId: number } & MetricSample;

export const SERVER_METRICS_SAMPLE_TTL_MS = 35_000;

type CacheEntry = {
    sample: MetricSample;
    updatedAtMs: number;
};

const cache = new Map<number, CacheEntry>();

export function setServerMetricsSample(serverId: number, sample: MetricSample): void {
    cache.set(serverId, { sample, updatedAtMs: Date.now() });
}

export function retainServerMetricsSamples(serverIds: Iterable<number>): void {
    const keep = new Set(serverIds);

    for (const serverId of cache.keys()) {
        if (!keep.has(serverId)) cache.delete(serverId);
    }
}

export function getServerMetricsSamples(): ServerMetricsSample[] {
    const cutoff = Date.now() - SERVER_METRICS_SAMPLE_TTL_MS;
    const samples: ServerMetricsSample[] = [];

    for (const [serverId, entry] of cache) {
        if (entry.updatedAtMs < cutoff) {
            cache.delete(serverId);
            continue;
        }
        samples.push({ serverId, ...entry.sample });
    }

    return samples.sort((a, b) => a.serverId - b.serverId);
}

export function getServerResourceSnapshot(serverId: number) {
    const entry = cache.get(serverId);
    if (!entry || entry.updatedAtMs < Date.now() - SERVER_METRICS_SAMPLE_TTL_MS || !entry.sample.resources)
        return { observedAt: null, resources: null };
    return { observedAt: new Date(entry.updatedAtMs).toISOString(), resources: entry.sample.resources };
}
