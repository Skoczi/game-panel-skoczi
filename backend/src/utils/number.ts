export function round2(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function parseLimit(raw: unknown, fallback = 100, max = 2000): number {
    const n = Number.parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
}
