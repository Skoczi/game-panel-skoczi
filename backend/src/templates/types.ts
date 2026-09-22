export type GameTemplate = {
    schemaVersion: 1 | 2;
    name: string; description: string; author: string; source: string;
    runtime: {
        provider: 'linuxgsm' | 'ovhcloud' | 'external'; image: string; catalogId: string; gameServerName: string;
        architectures: Array<'x64' | 'arm64'>;
        identity?: { user: string; uid: number; gid: number };
    };
    ports: Array<{ key: string; label: string; protocol: 'tcp' | 'udp'; container: number; suggested: number; env: string; linuxgsmKey: string }>;
    variables: Array<{ key: string; label: string; type: 'string' | 'integer' | 'boolean'; required: boolean; secret: boolean; default: string }>;
    mounts: Array<{ key: string; containerPath: string }>;
    monitoring?: { protocol: 'a2s'; queryPort: string };
    fastDownload?: { enabled: boolean; gameRoot?: string; folders?: string[]; compression?: 'none' | 'bzip2'; configFile?: string };
    configFiles?: Array<{ root: string; path: string; label: string }>;
    lifecycle?: NativeLifecycle;
};
export type NativeLifecycle = {
    startup: string[];
    // Optional shared installer image; defaults to the game runtime for older templates.
    installerImage?: string;
    install: NativeStep[];
    update: NativeStep[];
    workdir: string;
    // Optional fixed console command sent before the fallback stop signal.
    stopCommand?: string;
    stopSignal: 'SIGTERM' | 'SIGINT';
    stopTimeoutSeconds: number;
};
export type NativeStep = { name: string; timeoutSeconds: number } & (
    { argv: string[]; script?: never } | { script: string; argv?: never }
);

export type GameMonitoringConfig = {
    enabled: boolean; protocol: 'a2s'; queryPort: number | null;
    intervalSeconds: number; startupGraceSeconds: number; failureThreshold: number;
};
export type GameQueryInfo = { name: string; map: string; players: number; maxPlayers: number; bots: number | null };
export type GameMonitoringState = 'disabled' | 'waiting' | 'starting' | 'online' | 'degraded' | 'offline' | 'stopped' | 'maintenance' | 'unavailable' | 'stale';
export type GameMonitoringSnapshot = {
    state: GameMonitoringState; checkedAt: string | null; lastSuccessAt: string | null;
    failures: number; incidentStartedAt: string | null; error: string | null;
    info: GameQueryInfo | null; latencyMs: number | null; runtimeKey: string | null;
};
export type GameMonitoringSummary = GameMonitoringSnapshot & { enabled: boolean; staleAfterSeconds: number };
export type GameMonitoringSettings = {
    config: GameMonitoringConfig; summary: GameMonitoringSummary;
    ports: Array<{ container: number; host: number; label: string }>;
    templateProfile: boolean;
};
