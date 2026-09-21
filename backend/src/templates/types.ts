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
    stopSignal: 'SIGTERM' | 'SIGINT';
    stopTimeoutSeconds: number;
};
export type NativeStep = { name: string; timeoutSeconds: number } & (
    { argv: string[]; script?: never } | { script: string; argv?: never }
);
