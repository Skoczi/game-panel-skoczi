import { confirmDialog } from '../../utils/confirmDialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_NODE, ACTIVE_SERVER, openFleet } from '../../utils/nodeContext';
import type { SettingsTab } from './access';
import { serverNumber, shortServerRoute, shortServerUrl } from '../../utils/serverLinks';

export type ServerPageTab = SettingsTab | 'console' | 'activity';
export const SERVER_PAGE_TABS: ServerPageTab[] = [
  'console',
  'filemanager',
  'gameconfig',
  'backup',
  'scheduledtasks',
  'containerconfig',
  'terminal',
  'activity',
];
export interface ServerPageRoute {
  node: string;
  id: string;
  tab: ServerPageTab;
}
function readRoute(): ServerPageRoute | null {
  const shortRoute = shortServerRoute();
  if (shortRoute && ACTIVE_SERVER && shortRoute.number === serverNumber(ACTIVE_SERVER.displayId))
    return {
      node: ACTIVE_NODE,
      id: String(ACTIVE_SERVER.runtimeId),
      tab: shortRoute.tab as ServerPageTab,
    };
  const match = /^#\/nodes\/([^/]+)\/servers\/(\d+)\/([^/]+)$/.exec(location.hash);
  if (match)
    return {
      node: match[1],
      id: match[2],
      tab: match[3] === 'network' ? 'containerconfig' : SERVER_PAGE_TABS.includes(match[3] as ServerPageTab)
        ? (match[3] as ServerPageTab)
        : 'console',
    };
  return ACTIVE_SERVER
    ? { node: ACTIVE_NODE, id: String(ACTIVE_SERVER.runtimeId), tab: 'console' }
    : null;
}
export function serverPageHash(route: ServerPageRoute) {
  const number = serverNumber(ACTIVE_SERVER?.displayId);
  if (number && route.node === ACTIVE_NODE && route.id === String(ACTIVE_SERVER?.runtimeId))
    return shortServerUrl(number, route.tab);
  return `#/nodes/${route.node}/servers/${route.id}/${route.tab}`;
}
export function useServerPageRoute() {
  const [route, setRoute] = useState(readRoute);
  const dirty = useRef(false);
  const acceptedUrl = useRef(location.href);
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const allowLeave = useCallback(
    async () => {
      if (!dirty.current) return true;
      if (!await confirmDialog('Discard unsaved file changes?', 'Unsaved changes', 'Discard changes')) return false;
      window.dispatchEvent(new CustomEvent('gp:discard-editor-drafts', { detail: { nodeId: ACTIVE_NODE, serverId: readRoute()?.id } }));
      return true;
    },
    []
  );
  const navigate = useCallback(
    async (next: ServerPageRoute | null) => {
      if (!await allowLeave()) return;
      history.pushState(
        null,
        '',
        next && serverPageHash(next).startsWith('/')
          ? serverPageHash(next)
          : `${location.pathname}${location.search}${next ? serverPageHash(next) : ''}`
      );
      acceptedUrl.current = location.href;
      setRoute(next);
      window.scrollTo(0, 0);
    },
    [allowLeave]
  );
  useEffect(() => {
    let checking = false;
    const changed = async () => {
      if (checking) return;
      if (location.href === acceptedUrl.current) return;
      checking = true;
      const destination = location.href;
      if (dirty.current) history.replaceState(null, '', acceptedUrl.current);
      const allowed = await allowLeave();
      checking = false;
      if (!allowed) return;
      history.replaceState(null, '', destination);
      acceptedUrl.current = location.href;
      const shortRoute = shortServerRoute();
      const requestedServer = new URLSearchParams(location.search).get('server');
      if (
        (location.pathname.startsWith('/s/') &&
          (!shortRoute || shortRoute.number !== serverNumber(ACTIVE_SERVER?.displayId))) ||
        (requestedServer && requestedServer !== ACTIVE_SERVER?.id)
      ) {
        // Runtime clients are bound at module load; never reuse them for another server.
        window.location.reload();
        return;
      }
      if (ACTIVE_SERVER && !shortRoute && !requestedServer && !location.hash) {
        openFleet();
        return;
      }
      setRoute(readRoute());
    };
    const unloading = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('popstate', changed);
    window.addEventListener('hashchange', changed);
    window.addEventListener('beforeunload', unloading);
    return () => {
      window.removeEventListener('popstate', changed);
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('beforeunload', unloading);
    };
  }, [allowLeave]);
  return { route, navigate, setDirty, allowLeave };
}
