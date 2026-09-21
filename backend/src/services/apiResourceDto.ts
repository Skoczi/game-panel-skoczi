export function resourceDto(input: unknown) {
    const value = input as { observedAt?: unknown; resources?: Record<string, unknown> | null } | null;
    if (!value || !('resources' in value)) throw new Error('Missing resource snapshot');
    if (value.resources === null) return { observedAt: null, resources: null };
    if (!value.resources || typeof value.resources !== 'object' || typeof value.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(value.observedAt))) throw new Error('Invalid resource snapshot');
    const stamp = Date.parse(value.observedAt);
    if (stamp < Date.now() - 35000 || stamp > Date.now() + 5000) return { observedAt: null, resources: null };
    const number = (key: string) => {
        const n = value.resources![key];
        return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    };
    return { observedAt: new Date(stamp).toISOString(), resources: {
        cpuCores: number('cpuCores'), cpuLimitCores: number('cpuLimitCores'), cpuLimitPercent: number('cpuLimitPercent'),
        memoryBytes: number('memoryBytes'), memoryLimitBytes: number('memoryLimitBytes'), memoryLimitPercent: number('memoryLimitPercent'),
        diskBytes: number('diskBytes'),
    } };
}
