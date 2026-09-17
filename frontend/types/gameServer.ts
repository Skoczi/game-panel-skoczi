// Modified by Skoczi: retain complete host bindings alongside legacy port summaries.
export interface PortBinding { host: number; container: number; label: string; hostIp?: string }
export interface InstallStep {
  key: string;
  optional: boolean;
}

export interface InstallInteraction {
  id: number;
  serverId: number;
  kind: 'hytale_auth_required' | 'hytale_profile_selection_required';
  status: 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled';
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
  expiresAt: string;
  timestamp: string;
}

export type GameServerStatus =
  | 'running'
  | 'stopped'
  | 'creating'
  | 'installing'
  | 'starting'
  | 'stopping'
  | 'restarting'
  | 'unhealthy'
  | 'failed';

export interface GameServer {
  id: string;
  name: string;
  game: string;
  provider?: string;
  catalogId?: string;
  port?: number;
  connectionHost?: string;
  portBindings?: { tcp: PortBinding[]; udp: PortBinding[] };
  portMappings?: {
    tcp: number[];
    udp: number[];
  };
  portLabels?: {
    tcp: Record<string, string>;
    udp: Record<string, string>;
  };
  status: GameServerStatus;
  dockerContainerId?: string | null;
  installStatus?: string | null;
  installProgress?: number | null;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  networkIn?: number;
  networkOut?: number;
  desiredState?: string;
  containerStatus?: string;
  healthStatus?: string;
  lastError?: string | null;
  providerMetadataJson?: string | null;
  resourceLimits?: { memoryMb: number; cpu: number } | null;
}
