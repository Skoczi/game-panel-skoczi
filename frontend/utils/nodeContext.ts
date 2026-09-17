import { clearAppCache } from './appStorage';

const KEY = 'gamepanel_active_node';
const valid = /^(?:local|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const ACTIVE_NODE = (() => {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && valid.test(value) ? value : 'local';
  } catch {
    return 'local';
  }
})();
export function selectNode(id: string) {
  if (!valid.test(id)) throw new Error('Invalid node');
  if (id === ACTIVE_NODE) return;
  // Per-tab identity. A full reload closes sockets and discards every server-ID cache.
  sessionStorage.setItem(KEY, id);
  clearAppCache();
  window.location.reload();
}
export function clearNodeSelection() {
  sessionStorage.removeItem(KEY);
}
export function runtimeUrl(url: string, nodeId = ACTIVE_NODE): string {
  if (nodeId === 'local') return url;
  if (!valid.test(nodeId)) throw new Error('Invalid node');
  if (/^\/api\/servers(?:\/|$)/.test(url) || url === '/api/system/bind-addresses')
    return `/api/nodes/${nodeId}/runtime${url}`;
  return url;
}
export const runtimePrefix = (id: string) => (id === 'local' ? '' : `/api/nodes/${id}/runtime`);
