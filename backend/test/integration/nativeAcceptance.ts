import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, chownSync, existsSync } from 'node:fs';
import path from 'node:path';

export async function exerciseNativeBackups({ root, id, runtime, agentName, gameContainer, docker, ok, request, waitFor }: any) {
  const base = `${root}/agent-app/servers/${id}`;
  const files = `${base}/data/serverfiles`;
  mkdirSync(files, { recursive: true });
  mkdirSync(`${base}/data/log`, { recursive: true });
  writeFileSync(`${files}/server.cfg`, 'original archive content');
  writeFileSync(`${base}/data/log/excluded.log`, 'must not be archived');
  chownSync(files, 101, 101); chownSync(`${files}/server.cfg`, 101, 101);
  const backupBase = runtime + `/api/servers/${id}/backups`;
  const waitJob = async (job: any, expected = 'completed') => {
    let record: any;
    await waitFor(async () => {
      record = (await ok(`${backupBase}/jobs/${job.id}`)).job;
      return record.status !== 'running';
    }, `backup job ${job.id}`);
    assert.equal(record.status, expected, JSON.stringify(record));
    return record;
  };
  const replayKey = randomUUID();
  const dropped = await request(`${backupBase}/create`, 'POST', { name: 'Live acceptance' }, replayKey, true);
  assert.equal(dropped.status, 202);
  const live = await request(`${backupBase}/create`, 'POST', { name: 'Live acceptance' }, replayKey);
  assert.equal(live.status, 202);
  await waitJob(live.value.job);
  const replay = await request(`${backupBase}/create`, 'POST', { name: 'Live acceptance' }, replayKey);
  assert.equal(replay.value.job.id, live.value.job.id);
  assert.equal((await ok(`${backupBase}/jobs`)).jobs.length, 1, 'Dropped reply and repeated key must not create another backup');
  assert.equal(JSON.parse(docker('inspect', gameContainer))[0].State.Running, true);
  let names = readdirSync(`${base}/data/backups`).filter(name => name.endsWith('.tar.gz'));
  const archive = names.find(name => name.includes('live-Live-acceptance'))!;
  assert.ok(archive);
  const entries = docker('exec', agentName, 'tar', '-tzf', `${base}/data/backups/${archive}`);
  assert.ok(entries.includes('serverfiles/server.cfg'));
  assert.ok(!entries.includes('excluded.log') && !entries.includes('backups/'));
  assert.equal(statSync(`${base}/data/backups/${archive}`).mode & 0o777, 0o600);
  const liveProtection = await ok(`${backupBase}/protection`);
  assert.equal(liveProtection.latestBackup.mode, 'live');
  assert.equal(liveProtection.latestBackup.name, archive);
  assert.equal(liveProtection.unverifiedCount, 0);
  assert.equal(liveProtection.archiveCount, 1);
  assert.ok(liveProtection.gameAllocatedBytes > 0 && liveProtection.nodeFreeBytes > 0);
  // Restore while live must fail without changing the active game files.
  const forbidden = await request(`${backupBase}/restore`, 'POST', { path: archive });
  if (forbidden.status === 202) await waitJob(forbidden.value.job, 'failed');
  else assert.equal(forbidden.status, 409);
  assert.equal(readFileSync(`${files}/server.cfg`, 'utf8'), 'original archive content');
  await ok(runtime + `/api/servers/${id}/stop`, 'POST', {});
  await waitFor(async () => !JSON.parse(docker('inspect', gameContainer))[0].State.Running, 'stopped before restore');
  await waitJob((await ok(`${backupBase}/create`, 'POST', { name: 'Offline acceptance' })).job);
  names = readdirSync(`${base}/data/backups`).filter(name => name.endsWith('.tar.gz'));
  assert.equal(names.length, 2);
  writeFileSync(`${files}/server.cfg`, 'current files kept in recovery');
  await waitJob((await ok(`${backupBase}/restore`, 'POST', { path: archive })).job);
  assert.equal(readFileSync(`${files}/server.cfg`, 'utf8'), 'original archive content');
  assert.equal(statSync(`${files}/server.cfg`).uid, 101);
  const recovery = readdirSync(`${base}/data/backups`).find(name => name.startsWith('recovery-'))!;
  assert.equal(readFileSync(`${base}/data/backups/${recovery}/serverfiles/server.cfg`, 'utf8'), 'current files kept in recovery');

  const restoredProtection = await ok(`${backupBase}/protection`);
  assert.equal(restoredProtection.lastRestore.status, 'completed');
  assert.equal(restoredProtection.latestBackup.mode, 'offline');
  assert.equal(restoredProtection.recoveryCount, 1);
  assert.ok(restoredProtection.recoveryAllocatedBytes > 0);
  const server = (await ok(runtime + `/api/servers/${id}`)).server;
  // Execute the production restore implementation in a disposable worker; SIGKILL at
  // real rename boundaries leaves exactly the journal consumed by agent boot recovery.
  for (const point of ['before-old', 'after-old', 'after-new']) {
    writeFileSync(`${files}/server.cfg`, `pre-crash ${point}`);
    const row = { id, docker_container_id: gameContainer, provider_metadata_json: JSON.stringify(server.providerMetadata) };
    const source = `
      import { promises as fs } from 'node:fs';
      const rename = fs.rename.bind(fs);
      fs.rename = async (from, to) => {
        const old = from === ${JSON.stringify(files)};
        const fresh = to === ${JSON.stringify(files)};
        if (old && ${JSON.stringify(point)} === 'before-old') process.kill(process.pid, 'SIGKILL');
        await rename(from, to);
        if ((old && ${JSON.stringify(point)} === 'after-old') || (fresh && ${JSON.stringify(point)} === 'after-new')) process.kill(process.pid, 'SIGKILL');
      };
      const { restoreNativeBackup } = await import('./dist/services/nativeRestore.js');
      await restoreNativeBackup(${JSON.stringify(row)}, ${JSON.stringify(archive)});
      throw new Error('Fault checkpoint was not reached');
    `;
    assert.throws(() => docker('exec', agentName, 'node', '--input-type=module', '-e', source), (error: any) => error.status === 137);
    assert.ok(existsSync(`${base}/.native-restore.json`));
    docker('kill', '--signal=KILL', agentName);
    docker('start', agentName);
    await waitFor(async () => (await request(runtime + '/api/health')).status === 200 && !existsSync(`${base}/.native-restore.json`), 'boot restore recovery');
    assert.equal(readFileSync(`${files}/server.cfg`, 'utf8'), `pre-crash ${point}`);
    assert.equal(JSON.parse(docker('inspect', gameContainer))[0].State.Running, false);
  }
  const row = { id, docker_container_id: gameContainer, provider_metadata_json: JSON.stringify(server.providerMetadata) };
  const constrainedSource = `
    import assert from 'node:assert/strict';
    import { promises as fs } from 'node:fs';
    import { randomBytes } from 'node:crypto';
    const { createNativeBackup } = await import('./dist/services/nativeBackups.js');
    const { stageNativeArchive } = await import('./dist/services/nativeRestore.js');
    const before = await fs.readFile(${JSON.stringify(`${files}/server.cfg`)}, 'utf8');
    const payload = ${JSON.stringify(`${files}/space-test.bin`)};
    await fs.writeFile(payload, randomBytes(1024 * 1024));
    try {
      await assert.rejects(createNativeBackup(${JSON.stringify(row)}), /Not enough free space/);
      const actualStatfs = fs.statfs.bind(fs);
      // Separately force the real ENOSPC path even when preflight would prevent it.
      fs.statfs = async (...args) => ({ ...(await actualStatfs(...args)), bavail: 1048576 });
      try { await assert.rejects(createNativeBackup(${JSON.stringify(row)}), /No space left on device/); }
      finally { fs.statfs = actualStatfs; }
      assert.deepEqual(await fs.readdir(${JSON.stringify(`${base}/data/backups`)}), []);
      const staging = ${JSON.stringify(`${base}/data/backups/staging`)};
      await fs.mkdir(staging);
      await assert.rejects(stageNativeArchive('/archive.tar.gz', staging, ['serverfiles']), /Not enough free space/);
      assert.equal(await fs.readFile(${JSON.stringify(`${files}/server.cfg`)}, 'utf8'), before);
    } finally { await fs.unlink(payload); }
  `;
  docker('run', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${base}:${base}`, '-v', `${base}/data/backups/${archive}:/archive.tar.gz:ro`,
    '-v', `${root}/agent-identity:/identity:ro`,
    '--tmpfs', `${base}/data/backups:rw,size=64k`,
    '-e', 'GAMEPANEL_TEST_LOOPBACK_NODES=1', '-e', 'DOMAIN=acceptance.invalid', '-e', 'PORT=3001', '-e', 'JWT_SECRET=acceptance-only-secret-0000000000000',
    '-e', `GAMEPANEL_APP_ROOT=${root}/agent-app`, '-e', 'GAMEPANEL_AGENT_CONFIG=/identity/agent.json',
    process.env.GAMEPANEL_NODE_TEST_IMAGE || 'gamepanel-agent:ci', 'node', '--input-type=module', '-e', constrainedSource);
  assert.ok(existsSync(`${base}/data/backups/${archive}`), 'The original archive survives isolated disk-full tests');
  const cleanupUrl = `${backupBase}/retention?keepArchives=1&keepRecovery=1`;
  const preview = await ok(cleanupUrl);
  assert.ok(preview.remove.some((entry: any) => entry.name === archive));
  const unchangedGame = readFileSync(`${files}/server.cfg`, 'utf8');
  writeFileSync(`${base}/data/backups/unreviewed.tar.gz`, 'new unreviewed file');
  const stale = await request(`${backupBase}/retention`, 'POST', { ...preview.policy, fingerprint: preview.fingerprint });
  assert.equal(stale.status, 409);
  assert.ok(existsSync(`${base}/data/backups/${archive}`));
  const fresh = await ok(cleanupUrl);
  const cleaned = await ok(`${backupBase}/retention`, 'POST', { ...fresh.policy, fingerprint: fresh.fingerprint });
  assert.ok(cleaned.removed.includes(archive));
  assert.equal(readFileSync(`${files}/server.cfg`, 'utf8'), unchangedGame);
  const retained = (await ok(`${backupBase}/protection`)).latestBackup;
  assert.ok(retained, 'Retain the latest recorded available backup');
  await ok(`${backupBase}/file`, 'PATCH', { path: '/' + retained.name, name: 'Renamed-acceptance.tar.gz' });
  const renamedProtection = await ok(`${backupBase}/protection`);
  assert.equal(renamedProtection.latestBackup.name, 'Renamed-acceptance.tar.gz');
  assert.equal(renamedProtection.latestBackup.validatedAt, retained.validatedAt);
  await ok(runtime + `/api/servers/${id}/start`, 'POST', {});
  console.log('Native acceptance: live/offline backups, archive scope, stopped restore, UID, real disk-full/restore space reserve and SIGKILL at three rename checkpoints passed');
}
