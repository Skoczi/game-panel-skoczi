// Keep confirmed deletions out of a briefly stale inventory after returning to the fleet.
// Global IDs are never reused; the short expiry still allows a restored registry to reappear.
const KEY = 'gp_confirmed_server_deletions';
const TTL = 5 * 60_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function recent(): Array<{ id: string; until: number }> {
  try {
    const rows = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(row => uuid.test(row?.id) && Number.isFinite(row.until) && row.until > Date.now() && row.until <= Date.now() + TTL).slice(-100) : [];
  } catch { return []; }
}
export function recordFleetDeletion(id: string) {
  if (!uuid.test(id)) return;
  try { sessionStorage.setItem(KEY, JSON.stringify([...recent().filter(row => row.id !== id), { id, until: Date.now() + TTL }].slice(-100))); } catch { /* Inventory refresh still removes the server. */ }
}
export function withoutDeletedServers<T extends { id: string }>(servers: T[]): T[] {
  const deleted = new Set(recent().map(row => row.id));
  return servers.filter(server => !deleted.has(server.id));
}
