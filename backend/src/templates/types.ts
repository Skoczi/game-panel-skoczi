export type GameTemplate = {
    schemaVersion: 1;
    name: string; description: string; author: string; source: string;
    runtime: {
        provider: 'linuxgsm' | 'ovhcloud' | 'external'; image: string; catalogId: string; gameServerName: string;
        architectures: Array<'x64' | 'arm64'>;
        identity?: { user: string; uid: number; gid: number };
    };
    ports: Array<{ key: string; label: string; protocol: 'tcp' | 'udp'; container: number; suggested: number; env: string; linuxgsmKey: string }>;
    variables: Array<{ key: string; label: string; type: 'string' | 'integer' | 'boolean'; required: boolean; secret: boolean; default: string }>;
    mounts: Array<{ key: string; containerPath: string }>;
};
