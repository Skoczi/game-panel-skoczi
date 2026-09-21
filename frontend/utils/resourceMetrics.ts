export interface ResourceUsage {
  cpuCores: number | null;
  cpuLimitCores: number | null;
  cpuLimitPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  memoryLimitPercent: number | null;
  diskBytes?: number | null;
  nodeFreeBytes?: number | null;
}
export const resourceBytes = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return 'No data';
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : `${(value / 1024 ** 2).toFixed(0)} MiB`;
};
export function resourceLabel(resources: ResourceUsage | undefined, metric: 'cpu' | 'memory' | 'disk') {
  if (!resources) return 'No data';
  if (metric === 'disk') return resourceBytes(resources.diskBytes);
  if (metric === 'memory') return resources.memoryBytes == null ? 'No data' : `${resourceBytes(resources.memoryBytes)} / ${resources.memoryLimitBytes ? resourceBytes(resources.memoryLimitBytes) : 'no limit'}`;
  return resources.cpuCores == null ? 'No data' : `${resources.cpuCores.toFixed(2)} / ${resources.cpuLimitCores?.toFixed(2) ?? 'no limit'} vCPU`;
}
