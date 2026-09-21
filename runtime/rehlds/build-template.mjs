import { readFileSync, writeFileSync } from 'node:fs';
const document = {
  schemaVersion: 2, name: 'Counter-Strike 1.6 · ReHLDS',
  description: 'Clean ReHLDS 3.15.0.896. Panel-owned installation script, locally hosted checksum-pinned engine, Steam legacy game files. No AMXX/ReAPI/Reunion; no automatic updates. Test before production use.',
  author: 'Skoczi (template); ReHLDS contributors; Valve (game files)',
  source: 'https://github.com/rehlds/ReHLDS/releases/tag/3.15.0.896',
  runtime: { provider: 'external', image: 'gamepanel-runtime:linux-v1', catalogId: '', gameServerName: '', architectures: ['x64'], identity: { user: '1000', uid: 1000, gid: 1000 } },
  ports: [{ key: 'game', label: 'Game / Query / RCON', protocol: 'udp', container: 27015, suggested: 27015, env: 'SERVER_PORT', linuxgsmKey: '' }],
  variables: [
    { key: 'SERVER_NAME', label: 'Server name', type: 'string', required: true, secret: false, default: 'Counter-Strike 1.6 ReHLDS Server' },
    { key: 'MAP', label: 'Starting map', type: 'string', required: true, secret: false, default: 'de_dust2' },
    { key: 'MAX_PLAYERS', label: 'Maximum players (1-32)', type: 'integer', required: true, secret: false, default: '16' }
  ],
  mounts: [{ key: 'data', containerPath: '/data' }],
  configFiles: [
    { root: 'data', path: '/serverfiles/cstrike/server.cfg', label: 'Server settings' },
    { root: 'data', path: '/serverfiles/cstrike/mapcycle.txt', label: 'Map rotation' },
    { root: 'data', path: '/serverfiles/cstrike/banned.cfg', label: 'Banned players' },
    { root: 'data', path: '/serverfiles/cstrike/listip.cfg', label: 'Banned addresses' }
  ],
  lifecycle: {
    installerImage: 'gamepanel-installer:steamcmd-v1', workdir: '/data',
    startup: ['/bin/bash', '-c', readFileSync(new URL('./start.sh', import.meta.url), 'utf8'), 'hlds', '-console', '-game', 'cstrike', '-ip', '0.0.0.0', '-port', '{{SERVER_PORT}}', '-strictportbind', '+servercfgfile', 'gamepanel-startup.cfg', '+maxplayers', '{{MAX_PLAYERS}}', '+map', '{{MAP}}'],
    stopSignal: 'SIGINT', stopTimeoutSeconds: 30,
    install: [{ name: 'Install Steam legacy files and verified ReHLDS', timeoutSeconds: 1800, script: readFileSync(new URL('./install.sh', import.meta.url), 'utf8') }], update: []
  }
};
writeFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), JSON.stringify(document, null, 2) + '\n');
