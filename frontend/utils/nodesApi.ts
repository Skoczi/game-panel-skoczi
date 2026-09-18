import { getStoredToken } from './api/runtime';
export type ExecutionNode = {
  id: string;
  name: string;
  origin: string;
  location: string;
  enabled: number;
  status: 'pending' | 'disabled' | 'online' | 'offline';
  last_seen: number | null;
  agent_version: string | null;
};
export async function nodesRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST'
): Promise<T> {
  const controller = new AbortController();
  // Allocation saves verify ownership across runtimes before the signed write/readback.
  const timer = setTimeout(() => controller.abort(), /\/allocations(?:\/retry)?$/.test(path) ? 90000 : 15000);
  try {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${getStoredToken() || ''}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(value.error || `Request failed (${response.status})`), {
        status: response.status,
      });
    return value as T;
  } finally {
    clearTimeout(timer);
  }
}
