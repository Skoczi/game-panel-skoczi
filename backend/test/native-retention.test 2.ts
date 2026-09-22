import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { loadWithMocks } from './loadWithMocks.js';
const { planNativeRetention, applyNativeRetention } = loadWithMocks('../src/services/nativeRetention.ts', {
  'node:fs': { promises: fs }, 'node:path': path, 'node:crypto': { createHash },
  './nativeProtection.js': { readNativeBackupRecord: async (filename: string) => path.basename(filename) === 'old-verified.tar.gz' ? { name: 'old-verified.tar.gz', createdAt: '2026-09-01T00:00:00Z' } : null, forgetNativeBackupRecord: async () => {} },
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-retention-'));
  const data = path.join(root, 'data'); const backups = path.join(data, 'backups'); await fs.mkdir(backups, { recursive: true });
  for (const [i, name] of ['old-verified.tar.gz', 'old.tar.gz', 'new.tar.gz'].entries()) {
    const filename = path.join(backups, name); await fs.writeFile(filename, name); await fs.utimes(filename, i + 100, i + 100);
  }
  for (const [i, name] of ['recovery-aaa', 'recovery-bbb', 'recovery-ccc'].entries()) {
    const directory = path.join(backups, name); await fs.mkdir(path.join(directory, 'serverfiles'), { recursive: true });
    await fs.writeFile(path.join(directory, 'serverfiles/world'), 'old world');
    await fs.writeFile(path.join(directory, 'recovery.json'), JSON.stringify({ state: i === 2 ? 'prepared' : 'completed', mounts: ['serverfiles'] }));
    await fs.utimes(directory, i + 100, i + 100);
  }
  return { root, data, backups };
}
test('preview preserves latest archive, last validated archive, newest complete and incomplete recovery', async () => {
  const { root, data, backups } = await fixture();
  try {
    const policy = { keepArchives: 1, keepRecovery: 1 };
    const plan = await planNativeRetention(data, policy);
    assert.deepEqual(Array.from(plan.remove, (entry: any) => entry.name).sort(), ['old.tar.gz', 'recovery-aaa']);
    assert.equal((await fs.readdir(backups)).length, 6, 'preview never removes data');
    const result = await applyNativeRetention(data, policy, plan.fingerprint);
    assert.equal(result.removed.length, 2);
    for (const name of ['old-verified.tar.gz', 'new.tar.gz', 'recovery-bbb', 'recovery-ccc']) assert(await fs.stat(path.join(backups, name)));
    await assert.rejects(applyNativeRetention(data, policy, plan.fingerprint), /changed since the preview/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('changed inventories, changed policies and pending restore invalidate cleanup before deletion', async () => {
  const { root, data, backups } = await fixture();
  try {
    const policy = { keepArchives: 1, keepRecovery: 1 }; const plan = await planNativeRetention(data, policy);
    await assert.rejects(applyNativeRetention(data, { keepArchives: 2, keepRecovery: 1 }, plan.fingerprint), /changed since the preview/);
    await fs.writeFile(path.join(backups, 'old.tar.gz'), 'changed');
    await assert.rejects(applyNativeRetention(data, policy, plan.fingerprint), /changed since the preview/);
    assert(await fs.stat(path.join(backups, 'recovery-aaa')));
    await fs.writeFile(path.join(root, '.native-restore.json'), '{}');
    await assert.rejects(planNativeRetention(data, policy), /pending restore/);
    await assert.rejects(planNativeRetention(data, { keepArchives: 0, keepRecovery: 1 }), /between 1 and 100/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('cleanup never follows a symbolic archive or recovery directory outside storage', async () => {
  const { root, data, backups } = await fixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-retention-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'keep'), 'untouched');
    await fs.symlink(outside, path.join(backups, 'recovery-ddd'));
    await fs.symlink(path.join(outside, 'keep'), path.join(backups, 'link.tar.gz'));
    const policy = { keepArchives: 1, keepRecovery: 1 }; const plan = await planNativeRetention(data, policy);
    assert(!plan.remove.some((entry: any) => entry.name === 'link.tar.gz' || entry.name === 'recovery-ddd'));
    await applyNativeRetention(data, policy, plan.fingerprint);
    assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'untouched');
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});
