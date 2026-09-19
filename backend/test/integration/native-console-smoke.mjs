// Run in a disposable backend container with an EMPTY /data tmpfs, no network,
// the host Docker socket, and an already loaded shared runtime image.
// Never run against the live panel/agent database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
assert.equal(process.env.NATIVE_SMOKE_ISOLATED, 'yes');
assert.deepEqual(await fs.readdir('/data'), []);
const { docker } = await import('./dist/utils/docker/client.js');
const { getDatabase, closeDatabase } = await import('./dist/database/init.js');
const { runNativeSteps } = await import('./dist/services/nativeRuntime.js');
const { nativeLogHistory } = await import('./dist/services/nativeLogs.js');
const { sendGameConsoleCommand } = await import('./dist/services/gameConsole.js');
const { NATIVE_CS16_TEMPLATE } = await import('./dist/templates/nativeCs16.js');
const { validateTemplate, templateHash } = await import('./dist/templates/schema.js');
const { bus } = await import('./dist/realtime/bus.js');
const db = await getDatabase();
await db.run("INSERT INTO game_servers(id,name,provider,docker_image,ports_json,created_at,updated_at) VALUES(1,'isolated-smoke','external','test','{}','now','now')");
await db.run("INSERT INTO installation_progress(server_id,started_at,created_at,updated_at) VALUES(1,'now','now','now')");
const t = structuredClone(NATIVE_CS16_TEMPLATE);
t.variables.push({ key: 'SMOKE_SECRET', label: 'Secret', type: 'string', required: true, secret: true, default: '' });
t.lifecycle.install = [{ name: 'Smoke installer', script: 'printf "installer-first\\n"\nsleep 1\nprintf "token=%s\\ninstaller-last\\n" "$SMOKE_SECRET"', timeoutSeconds: 30 }];
const template = validateTemplate(t);
const image = (await docker.getImage('gamepanel-runtime:linux-v1').inspect()).Id;
let emitted = [];
bus.on('server.native.logs', e => emitted.push(...e.lines));
const opts = { serverId: 1, image, template, phase: 'install', env: { MAP: 'de_dust2', MAX_PLAYERS: '16', SERVER_PORT: '27015', SMOKE_SECRET: 'smoke-private-secret' }, mounts: [] };
await runNativeSteps(opts);
const history = await nativeLogHistory(1);
assert(history.some(l => l.includes('installer-first')));
assert(history.some(l => l.includes('installer-last')));
assert(history.some(l => l.includes('[REDACTED]')));
assert(!history.join('\n').includes('smoke-private-secret'));
assert(emitted.some(l => l.includes('installer-last')));
assert.equal((await db.get('SELECT status FROM installation_progress')).status, 'native_step_0');
const game = await docker.createContainer({
  Image: image, name: `gp-native-console-smoke-${randomUUID()}`,
  Entrypoint: [], Cmd: ['/bin/sh', '-c', 'while IFS= read -r line; do printf "reply:%s\\n" "$line"; done'],
  User: '1000:1000', OpenStdin: true, StdinOnce: false,
  Labels: { 'gamepanel.managed': 'true', 'gamepanel.serverId': '1', 'gamepanel.smoke': 'native-console' },
  HostConfig: { NetworkMode: 'none', CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Memory: 128 * 1024 ** 2, PidsLimit: 32 },
});
try {
  await game.start();
  const server = { id: 1, provider: 'external', docker_container_id: game.id, provider_metadata_json: JSON.stringify({ template: { document: template, hash: templateHash(template) } }) };
  await sendGameConsoleCommand(server, 'status');
  await new Promise(resolve => setTimeout(resolve, 300));
  await sendGameConsoleCommand(server, 'version');
  let logs = '';
  for (let i = 0; i < 20; i++) {
    logs = (await game.logs({ stdout: true, stderr: true })).toString();
    if (logs.includes('reply:status') && logs.includes('reply:version')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(logs.includes('reply:status') && logs.includes('reply:version'));
  assert((await game.inspect()).State.Running, 'Disconnecting console must not close game stdin');
  const { createNativeBackup, nativeBackupDirectory } = await import('./dist/services/nativeBackups.js');
  const { getServerStoragePaths } = await import('./dist/utils/storage.js');
  const { serverRoot } = getServerStoragePaths(1);
  await fs.mkdir(`${serverRoot}/data/serverfiles`, { recursive: true });
  await fs.writeFile(`${serverRoot}/data/serverfiles/server.cfg`, 'hostname isolated-smoke');
  await assert.rejects(createNativeBackup(server), /Stop the server/);
  await game.stop({ t: 1 });
  assert((await createNativeBackup(server)).ok);
  const names = await fs.readdir(await nativeBackupDirectory(server));
  assert.equal(names.length, 1);
  assert(names[0].endsWith('.tar.gz'));
} finally { await game.remove({ force: true }); await closeDatabase(); }
console.log('PASS: persisted/redacted installer logs, realtime batches, named progress, repeated native stdin commands, stopped-server native backup; test container removed');
