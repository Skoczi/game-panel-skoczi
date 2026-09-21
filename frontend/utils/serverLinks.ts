// Public URLs use the permanent fleet number, never a node-local runtime ID.
export const SERVER_TAB_SLUGS: Record<string, string> = {
  console: 'console',
  filemanager: 'files',
  gameconfig: 'config',
  backup: 'backups',
  scheduledtasks: 'schedules',
  network: 'network',
  containerconfig: 'settings',
  terminal: 'terminal',
  activity: 'activity',
};
export function serverNumber(displayId?: string): string | null {
  const match = /^SRV-([1-9]\d*)$/.exec(displayId || '');
  return match && Number.isSafeInteger(Number(match[1])) ? match[1] : null;
}
export function shortServerRoute(path = location.pathname) {
  const match = /^\/s\/([1-9]\d*)(?:\/([^/]+))?\/?$/.exec(path);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
  const tab =
    Object.entries(SERVER_TAB_SLUGS).find(
      ([key, slug]) => slug === match[2] || key === match[2]
    )?.[0] || 'console';
  return { number: match[1], tab };
}
export function shortServerUrl(number: string, tab: string) {
  return `/s/${number}/${SERVER_TAB_SLUGS[tab] || 'console'}`;
}
export function appRootPath() {
  return location.pathname.startsWith('/s/') ? '/' : location.pathname;
}
