import type { GameServerRow } from '../types/gameServer.js';

export type NormalizedResourceLimits = {
  memoryMb?: number;
  cpu?: number;
  cpuSet?: number[];
} | null;

const MIN_MEMORY_MB = 128;
const MIN_CPU = 0.1;
const BYTES_PER_MB = 1024 * 1024;
const NANO_CPUS_PER_CPU = 1_000_000_000;

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function parseMemoryMb(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) {
    throw new Error('resourceLimits.memoryMb must be an integer');
  }
  if (n < MIN_MEMORY_MB) {
    throw new Error(`resourceLimits.memoryMb must be at least ${MIN_MEMORY_MB}`);
  }

  return n;
}

function parseCpu(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;

  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error('resourceLimits.cpu must be a number');
  }
  if (n < MIN_CPU) {
    throw new Error(`resourceLimits.cpu must be at least ${MIN_CPU}`);
  }

  return Math.round(n * 1000) / 1000;
}

export function normalizeResourceLimitsPayload(value: unknown): NormalizedResourceLimits {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('resourceLimits must be an object or null');
  }

  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set(['memoryMb', 'cpu', 'cpuSet']);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported resourceLimits field: ${key}`);
    }
  }

  const memoryMb = hasOwn(raw, 'memoryMb') ? parseMemoryMb(raw.memoryMb) : undefined;
  const cpu = hasOwn(raw, 'cpu') ? parseCpu(raw.cpu) : undefined;

  let cpuSet: number[] | undefined;
  if (hasOwn(raw, 'cpuSet')) {
    if (!Array.isArray(raw.cpuSet) || raw.cpuSet.length > 4096 || !raw.cpuSet.every(id => Number.isSafeInteger(id) && id >= 0 && id <= 65535)) throw new Error('cpuSet must be an array of logical CPU IDs');
    cpuSet = [...new Set(raw.cpuSet as number[])].sort((a, b) => a - b);
  }
  if (memoryMb === undefined && cpu === undefined && !cpuSet?.length) return null;

  return {
    ...(memoryMb !== undefined ? { memoryMb } : {}),
    ...(cpu !== undefined ? { cpu } : {}),
    ...(cpuSet?.length ? { cpuSet } : {}),
  };
}

export function parseStoredResourceLimits(server: GameServerRow): NormalizedResourceLimits {
  const raw = server.resource_limits_json;
  if (!raw) return null;

  try {
    return normalizeResourceLimitsPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function resourceLimitsToDockerHostConfig(limits: NormalizedResourceLimits): Record<string, number | string> {
  if (!limits) return {};

  return {
    ...(limits.cpuSet?.length ? { CpusetCpus: limits.cpuSet.join(',') } : {}),
    ...(limits.memoryMb !== undefined ? { Memory: limits.memoryMb * BYTES_PER_MB } : {}),
    ...(limits.cpu !== undefined ? { NanoCpus: Math.round(limits.cpu * NANO_CPUS_PER_CPU) } : {}),
  };
}

export function resourceLimitsToDockerUpdatePayload(limits: NormalizedResourceLimits): Record<string, number | string> {
  return {
    CpusetCpus: limits?.cpuSet?.join(',') ?? '',
    Memory: limits?.memoryMb !== undefined ? limits.memoryMb * BYTES_PER_MB : 0,
    NanoCpus: limits?.cpu !== undefined ? Math.round(limits.cpu * NANO_CPUS_PER_CPU) : 0,
  };
}

// Older clients replacing CPU/RAM must not silently remove a binding.
export function mergeResourceLimitsBinding(value: unknown, current: NormalizedResourceLimits): NormalizedResourceLimits {
  const normalized = normalizeResourceLimitsPayload(value);
  if (value && typeof value === 'object' && hasOwn(value as Record<string, unknown>, 'cpuSet')) return normalized;
  return current?.cpuSet?.length ? { ...normalized, cpuSet: current.cpuSet } : normalized;
}
