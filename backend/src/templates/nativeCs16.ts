import type { GameTemplate } from './types.js';

// Separate draft, never a replacement for existing LinuxGSM installations.
export const NATIVE_CS16_TEMPLATE: GameTemplate = {
    schemaVersion: 2,
    name: 'Counter-Strike 1.6 · Native (preview)',
    description: 'Valve HLDS, direct startup and a locally packaged install recipe. Requires a preloaded gamepanel-runtime:steamcmd-v1 image. Not ReHLDS; no plugins are installed automatically. Test on a spare allocation before production use.',
    author: 'Skoczi', source: 'Valve HLDS / SteamCMD; native orchestration maintained in this fork',
    runtime: { provider: 'external', image: 'gamepanel-runtime:steamcmd-v1', catalogId: '', gameServerName: '', architectures: ['x64'], identity: { user: '1000', uid: 1000, gid: 1000 } },
    ports: [{ key: 'game', label: 'Game / Query / RCON', protocol: 'udp', container: 27015, suggested: 27015, env: 'SERVER_PORT', linuxgsmKey: '' }],
    monitoring: { protocol: 'a2s', queryPort: 'game' },
    variables: [
        { key: 'MAP', label: 'Starting map', type: 'string', required: true, secret: false, default: 'de_dust2' },
        { key: 'MAX_PLAYERS', label: 'Maximum players', type: 'integer', required: true, secret: false, default: '16' },
    ],
    mounts: [{ key: 'data', containerPath: '/data' }],
    lifecycle: {
        startup: ['/data/hlds_linux', '-console', '-game', 'cstrike', '-ip', '0.0.0.0', '-port', '{{SERVER_PORT}}', '-strictportbind', '+maxplayers', '{{MAX_PLAYERS}}', '+map', '{{MAP}}'],
        install: [{ name: 'Download and verify HLDS', argv: ['/usr/local/lib/gamepanel/cs16-install', 'install'], timeoutSeconds: 1800 }],
        update: [{ name: 'Update HLDS (no validate)', argv: ['/usr/local/lib/gamepanel/cs16-install', 'update'], timeoutSeconds: 1800 }],
        workdir: '/data', stopCommand: 'quit', stopSignal: 'SIGINT', stopTimeoutSeconds: 30,
    },
};
