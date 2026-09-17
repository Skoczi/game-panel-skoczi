export type Allocation = { ip: string; alias: string; tcp: string; udp: string };
export const DEFAULT_APPEARANCE = {
  showFollowUs: true, showTrustpilot: true, showNews: true,
  siteName: 'Game Panel', siteSubtitle: 'by Skoczi', logo: '',
  loginDescription: 'Sign in to manage your game servers',
  showLoginFooter: true, loginFooter: 'Game Panel by Skoczi',
};
export type Appearance = typeof DEFAULT_APPEARANCE;
export type GlobalSettings = {
  revision: number;
  appearance: Appearance;
  network: { restrictPorts: boolean; allocations: Allocation[] };
};
export type Assignment = { serverId: number; serverName: string; protocol: 'tcp' | 'udp'; ip: string; port: number };
