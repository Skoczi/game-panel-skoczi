/** Preserve actionable server errors and expose only validated correlation IDs. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const value = error as { message?: unknown; response?: { data?: { error?: unknown; requestId?: unknown }; headers?: Record<string, unknown> } };
  const data = value?.response?.data;
  const message = typeof data?.error === 'string' ? data.error
    : typeof value?.message === 'string' ? value.message : fallback;
  const requestId = data?.requestId ?? value?.response?.headers?.['x-request-id'];
  return typeof requestId === 'string' && /^[a-f0-9-]{36}$/i.test(requestId)
    ? `${message} (Reference: ${requestId})` : message;
}

export function mutationOutcomeUnknown(method: string | undefined, url: string, status?: number): boolean {
  return ['post', 'put', 'patch', 'delete'].includes((method || '').toLowerCase())
    && /\/api\/servers\/\d+\/(?:start|stop|restart|backups\/(?:create|restore|retention)|files\/extract)(?:\?|$)/.test(url)
    && (status === undefined || status >= 500);
}
