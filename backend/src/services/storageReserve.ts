import { promises as fs } from 'node:fs';
export const STORAGE_RESERVE_BYTES = 64 * 1024 * 1024;
const availableBytes = async (directory: string) => {
  const stat = await fs.statfs(directory);
  return Number(stat.bavail) * Number(stat.bsize);
};
// Polling limits damage from other writers; it cannot reserve blocks against external processes.
export function createStorageReserveGuard(probe = availableBytes, intervalMs = 500) {
  return async function withStorageReserve<T>(directory: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const check = async () => {
      const free = await probe(directory);
      if (!Number.isFinite(free) || free < STORAGE_RESERVE_BYTES) {
        throw new Error(`Not enough free space: keep at least 64 MiB free; available ${Number.isFinite(free) ? (free / 1024 ** 2).toFixed(1) + ' MiB' : 'unknown'}.`);
      }
    };
    await check();
    const controller = new AbortController();
    let issue: Error | undefined;
    let inFlight: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (inFlight || issue) return;
      inFlight = check().catch(error => {
        issue = error instanceof Error ? error : new Error('Unable to check storage reserve');
        controller.abort(issue);
      }).finally(() => { inFlight = undefined; });
    }, intervalMs);
    try { return await run(controller.signal); }
    finally {
      clearInterval(timer);
      await inFlight;
      if (issue) throw issue;
      // A short operation may finish before the first poll. Check before publishing its output.
      await check();
    }
  };
}
export const withStorageReserve = createStorageReserveGuard();
