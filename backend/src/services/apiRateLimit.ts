/** In-memory fixed windows. A restart clears counters; no distributed-rate-limit claim. */
export class ApiRateLimit {
    private buckets = new Map<string, { count: number; endsAt: number }>();
    constructor(private limit = 120, private windowMs = 60000, private maxKeys = 10000,
        private now: () => number = Date.now) {}
    take(key: string): { allowed: boolean; retryAfterSeconds: number } {
        const now = this.now();
        let bucket = this.buckets.get(key);
        if (bucket && bucket.endsAt <= now) { this.buckets.delete(key); bucket = undefined; }
        if (!bucket) {
            if (this.buckets.size >= this.maxKeys) {
                for (const [id, value] of this.buckets) if (value.endsAt <= now) this.buckets.delete(id);
                if (this.buckets.size >= this.maxKeys) return { allowed: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
            }
            bucket = { count: 0, endsAt: now + this.windowMs };
            this.buckets.set(key, bucket);
        }
        const allowed = bucket.count < this.limit;
        if (allowed) bucket.count++;
        return { allowed, retryAfterSeconds: Math.max(1, Math.ceil((bucket.endsAt - now) / 1000)) };
    }
}
