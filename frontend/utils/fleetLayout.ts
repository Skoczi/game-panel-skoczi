export type FleetLayout = {
  order: string[];
  sort: 'custom' | 'name' | 'type' | 'location' | 'status';
  group: 'none' | 'type';
  type: string;
  status: string;
};
export const defaultFleetLayout = (): FleetLayout => ({
  order: [],
  sort: 'custom',
  group: 'none',
  type: '',
  status: '',
});
export const fleetLayoutKey = (userId: number) => `gamepanel_fleet_layout_v1:${userId}`;
export function readFleetLayout(userId: number): FleetLayout {
  const result = defaultFleetLayout();
  try {
    const stored = JSON.parse(localStorage.getItem(fleetLayoutKey(userId)) || 'null');
    if (!stored || typeof stored !== 'object') return result;
    if (Array.isArray(stored.order))
      result.order = [
        ...new Set<string>(
          stored.order
            .filter((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
            .slice(0, 10000)
        ),
      ];
    if (['custom', 'name', 'type', 'location', 'status'].includes(stored.sort))
      result.sort = stored.sort;
    if (['none', 'type'].includes(stored.group)) result.group = stored.group;
    for (const key of ['type', 'status'] as const)
      if (typeof stored[key] === 'string' && stored[key].length < 400) result[key] = stored[key];
  } catch {
    /* Unavailable or damaged browser storage never blocks the workspace. */
  }
  return result;
}
export function fleetGame(
  server: { provider: string; catalogId?: string | null },
  names: Record<string, string>
) {
  if (server.provider === 'native') return { key: `native:${server.catalogId || 'unknown'}`, label: server.catalogId || 'Native Runtime' };
  if (server.catalogId)
    return {
      key: `${server.provider}:${server.catalogId}`,
      label: names[server.catalogId] || server.catalogId.replace(/[-_]/g, ' '),
    };
  return {
    key: `${server.provider}:unknown`,
    label:
      server.provider === 'external' ? 'Custom image' : `${server.provider} · Unspecified game`,
  };
}
