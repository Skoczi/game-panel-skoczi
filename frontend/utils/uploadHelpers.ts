export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export function isRetryableUploadError(err: any): boolean {
  const status = err?.response?.status;
  if (typeof status === 'number') return status >= 500 && status < 600;
  return true;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number; shouldRetry?: (err: any) => boolean },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 500;
  const shouldRetry = opts?.shouldRetry ?? isRetryableUploadError;

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1 || !shouldRetry(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
