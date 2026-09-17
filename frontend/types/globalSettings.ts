export type Allocation = { ip: string; alias: string; tcp: string; udp: string };
export type Appearance = { showFollowUs: boolean; showTrustpilot: boolean };
export type GlobalSettings = {
  revision: number;
  appearance: Appearance;
  network: { restrictPorts: boolean; allocations: Allocation[] };
};
export type Assignment = { serverId: number; serverName: string; protocol: 'tcp' | 'udp'; ip: string; port: number };
