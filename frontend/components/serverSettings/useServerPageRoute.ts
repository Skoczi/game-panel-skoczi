import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_NODE, ACTIVE_SERVER } from '../../utils/nodeContext';
import type { SettingsTab } from './access';

export type ServerPageTab = SettingsTab | 'console' | 'activity' | 'network';
export const SERVER_PAGE_TABS: ServerPageTab[] = [
  'console',
  'filemanager',
  'gameconfig',
  'backup',
  'scheduledtasks',
  'network',
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
  const match = /^#\/nodes\/([^/]+)\/servers\/(\d+)\/([^/]+)$/.exec(location.hash);
  if (match)
    return {
      node: match[1],
      id: match[2],
      tab: SERVER_PAGE_TABS.includes(match[3] as ServerPageTab)
        ? (match[3] as ServerPageTab)
        : 'console',
    };
  return ACTIVE_SERVER
    ? { node: ACTIVE_NODE, id: String(ACTIVE_SERVER.runtimeId), tab: 'console' }
    : null;
}
export function serverPageHash(route: ServerPageRoute) {
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
    () => !dirty.current || window.confirm('Discard unsaved file changes?'),
    []
  );
  const navigate = useCallback(
    (next: ServerPageRoute | null) => {
      if (!allowLeave()) return;
      history.pushState(
        null,
        '',
        `${location.pathname}${location.search}${next ? serverPageHash(next) : ''}`
      );
      acceptedUrl.current = location.href;
      setRoute(next);
      window.scrollTo(0, 0);
    },
    [allowLeave]
  );
  useEffect(() => {
    const changed = () => {
      if (location.href === acceptedUrl.current) return;
      if (!allowLeave()) {
        history.pushState(null, '', acceptedUrl.current);
        return;
      }
      acceptedUrl.current = location.href;
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
