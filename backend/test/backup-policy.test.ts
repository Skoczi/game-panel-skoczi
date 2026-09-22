import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadWithMocks } from './loadWithMocks.js';
async function syncDirectory(directory: string) {
  const file = await fs.open(directory, 'r'); try { await file.sync(); } finally { await file.close(); }
}
const protection = loadWithMocks('../src/services/nativeProtection.ts', {
  'node:fs': { promises: fs }, 'node:path': path, 'node:crypto': { randomUUID, createHash },
  'node:child_process': { execFile }, 'node:util': { promisify }, './nativeRestoreJournal.js': { syncDirectory },
});
const { recordNativeBackup } = protection;
const { planNativeRetention, applyNativeRetention } = loadWithMocks('../src/services/nativeRetention.ts', {
  'node:fs': { promises: fs }, 'node:path': path, 'node:crypto': { createHash }, './nativeProtection.js': protection,
});

test('backup policy defaults are opt-in, revisions prevent lost settings, corruption never disables protection silently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-backup-policy-'));
  const policy = loadWithMocks('../src/services/nativeBackupPolicy.ts', {
    'node:fs': { promises: fs }, 'node:path': path, 'node:crypto': { randomUUID },
    '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: dir }) },
    './nativeRestoreJournal.js': { syncDirectory },
  });
  try {
    const initial = await policy.readNativeBackupPolicy(1);
    assert.equal(initial.externalCopy, false); assert.equal(initial.automaticRetention, false);
    const saved = await policy.saveNativeBackupPolicy(1, { ...initial, automaticRetention: true });
    assert.equal(saved.revision, 1);
    assert.equal((await policy.readNativeBackupPolicy(1)).automaticRetention, true);
    await assert.rejects(policy.saveNativeBackupPolicy(1, initial), /changed/);
    assert.throws(() => policy.validateBackupPolicy({ ...saved, keepLocal: 0 }), /between/);
    assert.throws(() => policy.validateBackupPolicy({ ...saved, externalCopy: 'true' }), /between/);
    await fs.writeFile(path.join(dir, '.backup-policy.json'), '{broken');
    await assert.rejects(policy.readNativeBackupPolicy(1), /could not be read/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('automatic retention only removes validated archives and always keeps recovery and unrelated archives', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-auto-retention-'));
  try {
    const backups = path.join(dir, 'backups'); await fs.mkdir(backups);
    for (let i = 0; i < 3; i++) {
      const file = path.join(backups, `native-${i}.tar.gz`);
      await fs.writeFile(file, 'archive'); await fs.utimes(file, i + 100, i + 100);
      await recordNativeBackup(file, false);
    }
    await fs.writeFile(path.join(backups, 'manual.tar.gz'), 'preserve');
    await fs.mkdir(path.join(backups, 'recovery-aaa/serverfiles'), { recursive: true });
    await fs.writeFile(path.join(backups, 'recovery-aaa/recovery.json'), JSON.stringify({ state: 'completed', mounts: ['serverfiles'] }));
    const policy = { keepArchives: 1, keepRecovery: 1 };
    const plan = await planNativeRetention(dir, policy, true);
    assert.equal(plan.remove.length, 2);
    assert(plan.remove.every((x: any) => x.kind === 'archive' && x.name.startsWith('native-')));
    await applyNativeRetention(dir, policy, plan.fingerprint, true);
    assert(await fs.stat(path.join(backups, 'manual.tar.gz')));
    assert(await fs.stat(path.join(backups, 'recovery-aaa/serverfiles')));
    assert(await fs.stat(path.join(backups, 'native-2.tar.gz')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('external failure prevents local retention; a verified copy precedes every deletion', async () => {
  const calls: string[] = []; let fail = true;
  const service = loadWithMocks('../src/services/finishNativeBackup.ts', {
    'node:path': path,
    './externalBackups.js': { copyBackupExternally: async (_s: unknown, _a: string, _l: boolean, keep: number | null) => { calls.push(`copy:${keep}`); if (fail) throw new Error('offline'); return { removed: 0 }; } },
    './nativeRetention.js': { planNativeRetention: async () => { calls.push('plan'); return { fingerprint: 'reviewed' }; }, applyNativeRetention: async () => { calls.push('remove'); return { removed: ['old'] }; } },
    '../utils/storage.js': { getServerStoragePaths: () => ({ dataDir: '/test' }) },
  });
  const policy = { revision: 1, externalCopy: true, automaticRetention: true, keepLocal: 7, keepExternal: 14 };
  await assert.rejects(service.finishNativeBackup({ id: 1 }, '/archive', false, policy), /Local backup is ready.*local retention was not run/);
  assert.deepEqual(calls, ['copy:14']);
  calls.length = 0; fail = false;
  await service.finishNativeBackup({ id: 1 }, '/archive', false, policy);
  assert.deepEqual(calls, ['copy:14', 'plan', 'remove']);
  calls.length = 0;
  await service.finishNativeBackup({ id: 1 }, '/archive', false, { ...policy, automaticRetention: false });
  assert.deepEqual(calls, ['copy:null']);
});

test('automatic cleanup keeps the just-created backup even after the system clock moves backwards', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-clock-retention-'));
  try {
    const backups = path.join(dir, 'backups'); await fs.mkdir(backups);
    for (const [name, time] of [['native-old.tar.gz', 9000], ['native-new.tar.gz', 1000]] as const) {
      const filename = path.join(backups, name);
      await fs.writeFile(filename, name); await fs.utimes(filename, time, time);
      await recordNativeBackup(filename, false);
      const recordPath = path.join(backups, '.records', createHash('sha256').update(name).digest('hex') + '.json');
      const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
      record.createdAt = new Date(time * 1000).toISOString();
      record.validatedAt = record.createdAt;
      await fs.writeFile(recordPath, JSON.stringify(record));
    }
    const policy = { keepArchives: 1, keepRecovery: 1 };
    const plan = await planNativeRetention(dir, policy, true, 'native-new.tar.gz');
    assert(!plan.remove.some((entry: any) => entry.name === 'native-new.tar.gz'));
    await applyNativeRetention(dir, policy, plan.fingerprint, true, 'native-new.tar.gz');
    assert(await fs.stat(path.join(backups, 'native-new.tar.gz')));
    await assert.rejects(planNativeRetention(dir, policy, true, 'native-missing.tar.gz'), /cancelled/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
