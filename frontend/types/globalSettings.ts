export type Allocation = { ip: string; alias: string; tcp: string; udp: string };
export type LoginTheme = 'light' | 'dark' | 'system';
export const DEFAULT_APPEARANCE = {
  showFollowUs: false, showTrustpilot: false, showNews: false,
  siteName: 'Game Panel PRO', siteSubtitle: 'Server management', logo: '', favicon: '',
  loginDescription: 'Sign in to manage your game servers',
  loginTheme: 'light' as LoginTheme,
  showLoginFooter: true, loginFooter: 'Based on OVHcloud Game Panel · Developed by Skoczi',
};
export type Appearance = typeof DEFAULT_APPEARANCE;
export type GlobalSettings = {
  revision: number;
  appearance: Appearance;
  network: { restrictPorts: boolean; allocations: Allocation[] };
};
export type Assignment = { serverId: number; serverName: string; protocol: 'tcp' | 'udp'; ip: string; port: number };
