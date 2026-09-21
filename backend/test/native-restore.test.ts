import { withStorageReserve } from '../src/services/storageReserve.js';
import { validateNativeArchive } from '../src/services/nativeArchive.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as filesystem from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';
import { loadWithMocks } from './loadWithMocks.js';

async function archive(filename: string, entries: Array<{ name: string; type?: any; content?: string; linkname?: string }>) {
 const pack = tar.pack();
 const output = pipeline(pack, createGzip(), filesystem.createWriteStream(filename));
 for (const entry of entries) pack.entry({ name: entry.name, type: entry.type || 'file', mode: entry.type === 'directory' ? 0o750 : 0o640, linkname: entry.linkname }, entry.content || '');
 pack.finalize(); await output;
}
test('Native restore validates before replacing files, preserves logs and recovery copy, and rejects running games', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-restore-'));
 const data = path.join(root, 'data'); const backups = path.join(data, 'backups');
 let status = 'exited'; let releases = 0; let failSwap = false;
 const module = loadWithMocks('../src/services/nativeRestore.ts', {
  'node:fs': { ...filesystem, promises: { ...fs, rename: async (from: string, to: string) => { if (failSwap && from.includes('.restore-') && to === path.join(data, 'serverfiles')) { failSwap = false; throw new Error('swap failed'); } await fs.rename(from, to); } } },
  'node:path': path, 'node:crypto': { randomUUID }, 'node:zlib': { createGunzip }, 'node:stream/promises': { pipeline }, 'tar-stream': tar,
  './nativeBackups.js': { nativeBackupDirectory: async () => backups, nativeServerTemplate: () => ({ mounts: [{ key: 'data' }] }) },
  '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
  '../utils/docker.js': { checkContainerStatus: async () => status },
  './nativeOperationLock.js': { acquireNativeOperation: () => () => releases++, blockNativeServer: () => {} },
  './nativeArchive.js': { validateNativeArchive },
  './storageReserve.js': { withStorageReserve },
        './nativeRestoreJournal.js': { beginRestoreJournal: async () => {}, finishRestoreJournal: async () => {}, syncDirectory: async () => {} },
 }, { process });
 const server = { id: 1, docker_container_id: 'test' };
 try {
  await fs.mkdir(backups, { recursive: true }); await fs.mkdir(path.join(data, 'serverfiles'));
  await fs.writeFile(path.join(data, 'serverfiles', 'world'), 'current'); await fs.writeFile(path.join(data, 'log'), 'keep');
  const good = path.join(backups, 'good.tar.gz');
  await archive(good, [{ name: 'serverfiles/', type: 'directory' }, { name: 'serverfiles/world', content: 'restored' }, { name: 'serverfiles/world-link', type: 'symlink', linkname: 'world' }, { name: 'serverfiles/world-hard', type: 'link', linkname: 'serverfiles/world' }]);
  status = 'running'; await assert.rejects(module.restoreNativeBackup(server, 'good.tar.gz'), /Stop the server/); status = 'exited';
  for (const entry of [{ name: '../outside', content: 'bad' }, { name: 'serverfiles/link', type: 'symlink', linkname: '/etc' }, { name: 'log', content: 'bad' }]) {
   await archive(path.join(backups, 'bad.tar.gz'), [entry]);
   await assert.rejects(module.restoreNativeBackup(server, 'bad.tar.gz'));
   assert.equal(await fs.readFile(path.join(data, 'serverfiles', 'world'), 'utf8'), 'current');
  }
  failSwap = true; await assert.rejects(module.restoreNativeBackup(server, 'good.tar.gz'), /swap failed/);
  assert.equal(await fs.readFile(path.join(data, 'serverfiles', 'world'), 'utf8'), 'current');
  const result = await module.restoreNativeBackup(server, '/good.tar.gz');
  assert.equal(await fs.readFile(path.join(data, 'serverfiles', 'world'), 'utf8'), 'restored');
  assert.equal(await fs.readFile(path.join(backups, result.recovery, 'serverfiles', 'world'), 'utf8'), 'current');
  assert.equal(await fs.readFile(path.join(data, 'log'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(data, 'serverfiles', 'world-link'), 'utf8'), 'restored');
  assert.equal(await fs.readFile(path.join(data, 'serverfiles', 'world-hard'), 'utf8'), 'restored');
  assert.equal((await fs.stat(path.join(data, 'serverfiles'))).mode & 0o777, 0o750);
  assert.equal(releases, 6);
 } finally { await fs.rm(root, { recursive: true, force: true }); }
});
