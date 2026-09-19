import { runtimeUrl, type ServerContext } from './nodeContext';
import { nodesRequest } from './nodesApi';
import { getStoredToken } from './api/runtime';
import { mapBackendStatusToUi } from './serverRuntime';
import type { GameServer } from '../types/gameServer';

export type FleetRuntime = { context: ServerContext; server: GameServer; address?: string };
export const fleetAllowed = (context: ServerContext, permission: string) =>
  context.permissions.includes('*') || context.permissions.includes(permission);

export async function fleetContext(id: string): Promise<ServerContext> {
  const context = await nodesRequest<ServerContext>(`/api/fleet/${id}/context`);
  if (context.id !== id || !Number.isSafeInteger(context.runtimeId) || context.runtimeId <= 0)
    throw new Error('Server context unavailable');
  return context;
}

// Never mutate ACTIVE_NODE or session storage: each call carries its stable fleet identity.
export async function fleetRequest<T>(
  context: ServerContext,
  suffix = '',
  body?: unknown
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      runtimeUrl(`/api/servers/${context.runtimeId}${suffix}`, context.nodeId),
      {
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${getStoredToken() || ''}`,
          'Content-Type': 'application/json',
          'X-Gamepanel-Server': context.id,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }
    );
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Server unavailable');
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadFleetRuntime(id: string): Promise<FleetRuntime> {
  const context = await fleetContext(id);
  const { server: raw } = await fleetRequest<{ server: any }>(context);
  if (Number(raw?.id) !== context.runtimeId) throw new Error('Server context changed');
  const bindings = [...(raw.ports?.udp || []), ...(raw.ports?.tcp || [])];
  const binding =
    bindings.find((p) => p.hostIp && p.hostIp !== '0.0.0.0' && p.hostIp !== '::') || bindings[0];
  const host = binding?.hostIp;
  const address =
    host && host !== '0.0.0.0' && host !== '::' && binding?.host
      ? `${host.includes(':') ? `[${host}]` : host}:${binding.host}`
      : undefined;
  // Retain only display data; startup secrets and environment are deliberately discarded.
  const server: GameServer = {
    id,
    name: raw.name,
    game: raw.catalogId || raw.provider || '',
    status: mapBackendStatusToUi(raw.status),
    provider: raw.provider,
    providerMetadataJson: JSON.stringify({
      capabilities: {
        consoleCommand: raw.providerMetadata?.capabilities?.consoleCommand !== false,
      },
      template: raw.providerMetadata?.template
        ? { document: { schemaVersion: raw.providerMetadata.template.document?.schemaVersion } }
        : undefined,
    }),
    dockerContainerId: raw.dockerContainerId,
  };
  try {
    const result = await fleetRequest<{ metrics: any[] }>(context, '/metrics?limit=1');
    const metric = result.metrics?.[result.metrics.length - 1];
    if (metric) {
      const number = (value: unknown) =>
        value != null && Number.isFinite(Number(value)) ? Number(value) : undefined;
      server.cpuUsage = number(metric.cpuUsage ?? metric.cpu_usage ?? metric.cpu);
      server.memoryUsage = number(metric.memoryUsage ?? metric.memory_usage ?? metric.memory);
      server.diskUsage = number(metric.diskUsage ?? metric.disk_usage ?? metric.disk);
      server.networkIn = number(metric.networkIn ?? metric.network_in ?? metric.network?.in);
      server.networkOut = number(metric.networkOut ?? metric.network_out ?? metric.network?.out);
    }
  } catch {
    /* Unknown metrics stay unknown, not zero. */
  }
  return { context, server, address };
}

export function fleetSocketUrl(context: ServerContext) {
  const path = context.nodeId === 'local' ? '/api' : `/api/nodes/${context.nodeId}/ws`;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}?server=${encodeURIComponent(context.id)}`;
}
