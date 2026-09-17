import { clearAppCache } from './appStorage';

const KEY = 'gamepanel_active_node';
const SERVER_KEY = 'gamepanel_active_server';
const ADMIN_KEY = 'gamepanel_admin_runtime';
const valid = /^(?:local|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export type ServerContext = {
  id: string;
  nodeId: string;
  runtimeId: number;
  name: string;
  location: string;
  nodeName: string;
  permissions: string[];
  placementRevision: number;
};
export const ACTIVE_SERVER: ServerContext | null = (() => {
  try {
    const value = JSON.parse(sessionStorage.getItem(SERVER_KEY) || 'null');
    return value &&
      valid.test(value.id) &&
      value.id !== 'local' &&
      valid.test(value.nodeId) &&
      Number.isSafeInteger(value.runtimeId) &&
      value.runtimeId > 0
      ? value
      : null;
  } catch {
    return null;
  }
})();
export const ADMIN_RUNTIME = sessionStorage.getItem(ADMIN_KEY) === '1';
export const ACTIVE_NODE = (() => {
  try {
    const value = ACTIVE_SERVER?.nodeId || (ADMIN_RUNTIME ? sessionStorage.getItem(KEY) : null);
    return value && valid.test(value) ? value : 'local';
  } catch {
    return 'local';
  }
})();
export function selectNode(id: string) {
  if (!valid.test(id)) throw new Error('Invalid node');
  if (id === ACTIVE_NODE && ADMIN_RUNTIME && !ACTIVE_SERVER) return;
  // Per-tab identity. A full reload closes sockets and discards every server-ID cache.
  sessionStorage.setItem(KEY, id);
  sessionStorage.setItem(ADMIN_KEY, '1');
  sessionStorage.removeItem(SERVER_KEY);
  history.replaceState(null, '', location.pathname);
  clearAppCache();
  window.location.reload();
}
export function clearNodeSelection() {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(SERVER_KEY);
  sessionStorage.removeItem(ADMIN_KEY);
}
export function openServer(context: ServerContext) {
  clearNodeSelection();
  sessionStorage.setItem(SERVER_KEY, JSON.stringify(context));
  history.replaceState(null, '', `${location.pathname}?server=${encodeURIComponent(context.id)}`);
  clearAppCache();
  window.location.reload();
}
export function openFleet() {
  clearNodeSelection();
  history.replaceState(null, '', location.pathname);
  clearAppCache();
  window.location.reload();
}
export function runtimeUrl(url: string, nodeId = ACTIVE_NODE): string {
  if (nodeId === 'local') return url;
  if (!valid.test(nodeId)) throw new Error('Invalid node');
  if (/^\/api\/servers(?:\/|$)/.test(url) || url === '/api/system/bind-addresses')
    return `/api/nodes/${nodeId}/runtime${url}`;
  return url;
}
export const runtimePrefix = (id: string) => (id === 'local' ? '' : `/api/nodes/${id}/runtime`);
