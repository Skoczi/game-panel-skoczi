import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadWithMocks } from './loadWithMocks.js';
const { recordNativeBackup, inspectNativeProtection, readNativeBackupRecord, moveNativeBackupRecord } = loadWithMocks('../src/services/nativeProtection.ts', {
  'node:fs': { promises: fs }, 'node:path': path, 'node:crypto': { createHash, randomUUID },
  'node:child_process': { execFile }, 'node:util': { promisify },
  './nativeRestoreJournal.js': { syncDirectory: async (dir: string) => { const handle = await fs.open(dir, 'r'); try { await handle.sync(); } finally { await handle.close(); } } },
});
test('protection separates game, archive and recovery storage without modifying data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-protection-'));
  try {
    await fs.mkdir(path.join(root, 'serverfiles')); await fs.writeFile(path.join(root, 'serverfiles/world'), 'world');
    await fs.mkdir(path.join(root, 'backups/recovery-abc'), { recursive: true }); await fs.writeFile(path.join(root, 'backups/recovery-abc/old'), 'previous');
    const archive = path.join(root, 'backups/backup.tar.gz'); await fs.writeFile(archive, 'checked archive');
    const record = await recordNativeBackup(archive, true);
    const summary = await inspectNativeProtection(root);
    assert.equal(summary.archiveBytes, 15); assert.equal(summary.archiveCount, 1); assert.equal(summary.recoveryCount, 1);
    assert(summary.recoveryAllocatedBytes >= 8); assert(summary.gameAllocatedBytes >= 5); assert(summary.nodeFreeBytes > 0);
    assert.equal(summary.latestBackup.mode, 'live'); assert.equal(summary.latestBackup.validatedAt, record.validatedAt); assert.equal(summary.unverifiedCount, 0);
    assert.equal(await fs.readFile(path.join(root, 'serverfiles/world'), 'utf8'), 'world');
    await fs.writeFile(archive, 'changed archive');
    const changed = await inspectNativeProtection(root); assert.equal(changed.latestBackup, null); assert.equal(changed.unverifiedCount, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('old, renamed, damaged-record and symlink archives never gain a verified label', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-protection-records-'));
  try {
    await fs.mkdir(path.join(root, 'serverfiles')); await fs.mkdir(path.join(root, 'backups'));
    const archive = path.join(root, 'backups/original.tar.gz'); await fs.writeFile(archive, 'old');
    assert.equal((await inspectNativeProtection(root)).unverifiedCount, 1);
    await recordNativeBackup(archive, false);
    await fs.rename(archive, path.join(root, 'backups/renamed.tar.gz'));
    const renamed = await inspectNativeProtection(root); assert.equal(renamed.latestBackup, null); assert.equal(renamed.unverifiedCount, 1);
    const renamedPath = path.join(root, 'backups/renamed.tar.gz'); await recordNativeBackup(renamedPath, false);
    const record = path.join(root, 'backups/.records', createHash('sha256').update('renamed.tar.gz').digest('hex') + '.json');
    await fs.writeFile(record, '{broken'); assert.equal((await inspectNativeProtection(root)).latestBackup, null);
    await fs.symlink('/etc/passwd', path.join(root, 'backups/link.tar.gz')); assert.equal((await inspectNativeProtection(root)).archiveCount, 1);
    await fs.rm(path.join(root, 'serverfiles'), { recursive: true }); await fs.symlink('/etc', path.join(root, 'serverfiles'));
    const invalid = await inspectNativeProtection(root); assert.equal(invalid.gameAllocatedBytes, null); assert(invalid.warnings.length > 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('missing archive directory is empty but invalid storage is unknown, never zero', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-protection-missing-'));
  try {
    await fs.mkdir(path.join(root, 'serverfiles'));
    const empty = await inspectNativeProtection(root); assert.equal(empty.archiveBytes, 0); assert.equal(empty.archiveCount, 0);
    await assert.rejects(fs.stat(path.join(root, 'backups')));
    await fs.symlink('/etc', path.join(root, 'backups'));
    const invalid = await inspectNativeProtection(root); assert.equal(invalid.archiveCount, null); assert.equal(invalid.recoveryAllocatedBytes, null); assert.equal(invalid.latestBackup, null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('panel rename preserves the actual validation time and backup mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-protection-rename-'));
  try {
    await fs.mkdir(path.join(root, 'serverfiles')); await fs.mkdir(path.join(root, 'backups'));
    const from = path.join(root, 'backups/original.tar.gz'); const to = path.join(root, 'backups/renamed.tar.gz');
    await fs.writeFile(from, 'archive'); await recordNativeBackup(from, false);
    const record = await readNativeBackupRecord(from); await fs.rename(from, to); await moveNativeBackupRecord(from, to, record);
    const summary = await inspectNativeProtection(root); assert.equal(summary.latestBackup.name, 'renamed.tar.gz'); assert.equal(summary.latestBackup.validatedAt, record.validatedAt); assert.equal(summary.latestBackup.mode, 'offline'); assert.equal(summary.unverifiedCount, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
