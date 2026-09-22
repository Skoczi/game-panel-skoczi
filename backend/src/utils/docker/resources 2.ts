export type ResourceUsage = {
    cpuCores: number | null;
    cpuLimitCores: number | null;
    cpuLimitPercent: number | null;
    memoryBytes: number | null;
    memoryLimitBytes: number | null;
    memoryLimitPercent: number | null;
    diskBytes?: number | null;
    nodeFreeBytes?: number | null;
};
const positive = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
export function calculateResources(stats: any, config: any): ResourceUsage {
    const cpuDelta = stats.cpu_stats?.cpu_usage?.total_usage - stats.precpu_stats?.cpu_usage?.total_usage;
    const systemDelta = stats.cpu_stats?.system_cpu_usage - stats.precpu_stats?.system_cpu_usage;
    const cpus = positive(stats.cpu_stats?.online_cpus) ?? positive(stats.cpu_stats?.cpu_usage?.percpu_usage?.length);
    const cpuCores = cpus && systemDelta > 0 && cpuDelta >= 0 ? cpuDelta / systemDelta * cpus : null;
    const limits: number[] = [];
    if (positive(config.NanoCpus)) limits.push(config.NanoCpus / 1e9);
    if (positive(config.CpuQuota)) limits.push(config.CpuQuota / (positive(config.CpuPeriod) ?? 100000));
    if (config.CpusetCpus) {
        const set = new Set<number>();
        for (const part of String(config.CpusetCpus).split(',')) {
            const [start, end = start] = part.split('-').map(Number);
            if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end - start < 65536) for (let i = start; i <= end; i++) set.add(i);
        }
        if (set.size) limits.push(set.size);
    }
    const cpuLimitCores = limits.length ? Math.min(...limits) : null;
    const memory = stats.memory_stats;
    const raw = memory?.usage;
    // cgroup v1/v2 counters overlap; subtract only the applicable cache counter.
    const cache = memory?.stats?.total_inactive_file ?? memory?.stats?.inactive_file ?? memory?.stats?.cache ?? 0;
    const memoryBytes = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw - cache) : null;
    const memoryLimitBytes = positive(config.Memory);
    return { cpuCores, cpuLimitCores, cpuLimitPercent: cpuCores !== null && cpuLimitCores ? cpuCores / cpuLimitCores * 100 : null,
        memoryBytes, memoryLimitBytes, memoryLimitPercent: memoryBytes !== null && memoryLimitBytes ? memoryBytes / memoryLimitBytes * 100 : null };
}
