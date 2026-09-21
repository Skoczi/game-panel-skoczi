import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadWithMocks } from './loadWithMocks.js';
import * as locks from '../src/services/nativeOperationLock.js';
import * as browser from '../src/utils/fsBrowser.js';

test('managed backups reject file access and recursive parent downloads while the backup API remains usable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-private-'));
  try {
    await fs.mkdir(path.join(root, 'data/backups'), { recursive: true });
    const mod = loadWithMocks('../src/services/fileExplorer.ts', {
      'node:fs': { promises: fs },
      'node:path': path,
      '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
      '../utils/fsBrowser.js': browser,
      './servers.js': { getServerOrThrow: async () => ({ id: 1 }) },
      '../providers/runtimeConfig.js': {
        parseStoredMounts: () => [{ key: 'data', containerPath: '/data' }],
      },
      './nativeBackups.js': {
        nativeServerTemplate: () => ({}),
        nativeBackupDirectory: async () => path.join(root, 'data/backups'),
      },
    });
    for (const name of ['/backups', '/backups/file.tar.gz', '/serverfiles/../backups/recovery'])
      await assert.rejects(
        mod.resolveServerPath({ serverId: 1, root: 'data', path: name }),
        /managed backups/
      );
    await assert.rejects(
      mod.assertPublicServerPath(1, path.join(root, 'data'), true),
      /managed backups/
    );
    await fs.symlink('backups', path.join(root, 'data', 'alias'));
    await assert.rejects(
      mod.resolveServerPath({ serverId: 1, root: 'data', path: '/alias/secret' }),
      /managed backups/
    );
    await fs.unlink(path.join(root, 'data', 'alias'));
    assert.equal((await mod.listServerFiles({ serverId: 1, root: 'data' })).entries.length, 0);
    assert.equal(
      (await mod.resolveServerPath({ serverId: 1, root: 'native-backups', path: '/file.tar.gz' }))
        .absPath,
      path.join(root, 'data/backups/file.tar.gz')
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('restore journal recovers both crash windows, survives a fresh lock instance and retains displaced data', async () => {
  for (const installed of [false, true]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-journal-'));
    const data = path.join(root, 'data');
    const recovery = path.join(data, 'backups/recovery-abcd');
    const mod = loadWithMocks('../src/services/nativeRestoreJournal.ts', {
      'node:fs': { promises: fs },
      'node:path': path,
      '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
      './nativeOperationLock.js': locks,
    });
    try {
      await fs.mkdir(path.join(recovery, 'serverfiles'), { recursive: true });
      await fs.writeFile(path.join(recovery, 'serverfiles/world'), 'old');
      await mod.beginRestoreJournal(88, { recovery: 'recovery-abcd', staging: '.restore-ABC123' });
      if (installed) {
        await fs.mkdir(path.join(data, 'serverfiles'));
        await fs.writeFile(path.join(data, 'serverfiles/world'), 'new');
      }
      await mod.rollbackInterruptedRestore(88);
      assert.equal(await fs.readFile(path.join(data, 'serverfiles/world'), 'utf8'), 'old');
      assert.equal(await mod.hasRestoreJournal(88), false);
      locks.assertNativeIdle(88);
      if (installed)
        assert((await fs.readdir(recovery)).some((name) => name.startsWith('interrupted-')));
    } finally {
      locks.unblockNativeServer(88);
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('maintenance lock outlives the HTTP mutation that launched a background job', () => {
  const endRequest = locks.enterServerMutation(90);
  const endJob = locks.acquireNativeOperation(90, true);
  endRequest();
  assert.throws(() => locks.enterServerMutation(90), /running/);
  endJob();
  locks.enterServerMutation(90)();
});

test('extraction validates all conflicts before replacing any file and rolls back a failed commit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-extract-'));
  const data = path.join(root, 'data');
  let fail = false;
  const mod = loadWithMocks(
    '../src/services/extractionTransaction.ts',
    {
      'node:fs': {
        promises: {
          ...fs,
          rename: async (from: string, to: string) => {
            if (fail && from.includes('/new/') && to.endsWith('/b')) {
              fail = false;
              throw new Error('disk failure');
            }
            return fs.rename(from, to);
          },
        },
      },
      'node:path': path,
      'node:crypto': await import('node:crypto'),
      '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
      '../utils/fsBrowser.js': browser,
      './nativeRestoreJournal.js': { syncDirectory: async () => {} },
      './nativeOperationLock.js': locks,
    },
    { process }
  );
  try {
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'a'), 'old-a');
    await fs.writeFile(path.join(data, 'b'), 'old-b');
    const make = async () => {
      const dir = await fs.mkdtemp(path.join(root, 'stage-'));
      await fs.writeFile(path.join(dir, 'a'), 'new-a');
      await fs.writeFile(path.join(dir, 'b'), 'new-b');
      return dir;
    };
    await assert.rejects(mod.commitExtractedTree(91, await make(), data, false), /already exists/);
    assert.equal(await fs.readFile(path.join(data, 'a'), 'utf8'), 'old-a');
    fail = true;
    await assert.rejects(mod.commitExtractedTree(91, await make(), data, true), /disk failure/);
    assert.equal(await fs.readFile(path.join(data, 'a'), 'utf8'), 'old-a');
    assert.equal(await fs.readFile(path.join(data, 'b'), 'utf8'), 'old-b');
    assert.equal(await mod.hasExtractionTransaction(91), false);
    await mod.commitExtractedTree(91, await make(), data, true);
    assert.equal(await fs.readFile(path.join(data, 'a'), 'utf8'), 'new-a');
  } finally {
    locks.unblockNativeServer(91);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('backup jobs release HTTP immediately, retain results and reconcile interrupted records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-jobs-'));
  let done!: () => void;
  const mod = loadWithMocks(
    '../src/services/backupJobs.ts',
    {
      'node:fs': { promises: fs },
      'node:path': path,
      'node:crypto': await import('node:crypto'),
      '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
      './nativeOperationLock.js': locks,
      './nativeRestoreJournal.js': { syncDirectory: async () => {} },
      '../database/index.js': { actionsRepository: { create: async () => {} } },
    },
    { console }
  );
  try {
    const gate = new Promise<void>((resolve) => {
      done = resolve;
    });
    const job = await mod.startBackupJob(92, 'backup', 'tester', async () => {
      await gate;
      return { ok: true, exitCode: 0, stdout: 'done' };
    });
    assert.equal(job.status, 'running');
    assert.throws(() => locks.enterServerMutation(92), /running/);
    assert.equal((await mod.listBackupJobs(92))[0].status, 'running');
    done();
    for (let i = 0; i < 100 && (await mod.listBackupJobs(92))[0].status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await mod.listBackupJobs(92))[0].result.stdout, 'done');
    await fs.writeFile(path.join(root, '.backup-jobs', job.id + '.json'), JSON.stringify(job));
    await mod.recoverBackupJobs(92);
    assert.equal((await mod.listBackupJobs(92))[0].status, 'interrupted');
    assert.equal((await mod.listBackupJobs(92))[0].actor, 'tester');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('real archive extraction holds its lock, rejects a late invalid entry without overwriting, and commits nested files', async () => {
  const filesystem = await import('node:fs');
  const crypto = await import('node:crypto');
  const streams = await import('node:stream/promises');
  const zlib = await import('node:zlib');
  const tar = (await import('tar-stream')).default;
  const yazl = await import('yazl');
  const yauzl = await import('yauzl');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-extraction-flow-'));
  const data = path.join(root, 'data');
  let nextId = 0;
  const rows = new Map<number, any>();
  const repo = {
    create: async (input: any) => {
      const row = { id: ++nextId, ...input, status: 'pending', payload_json: '{}' };
      rows.set(row.id, row);
      return row;
    },
    start: async (id: number) => {
      rows.get(id).status = 'running';
    },
    updateProgress: async () => {},
    complete: async (id: number) => {
      rows.get(id).status = 'completed';
    },
    fail: async (id: number, error: string) => {
      Object.assign(rows.get(id), { status: 'failed', error });
    },
  };
  const transaction = loadWithMocks(
    '../src/services/extractionTransaction.ts',
    {
      'node:fs': { promises: fs },
      'node:path': path,
      'node:crypto': crypto,
      '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
      '../utils/fsBrowser.js': browser,
      './nativeRestoreJournal.js': { syncDirectory: async () => {} },
      './nativeOperationLock.js': locks,
    },
    { process }
  );
  const transfers = loadWithMocks(
    '../src/services/fileTransfers.ts',
    {
      'node:crypto': crypto,
      'node:fs': filesystem,
      'node:path': path,
      'node:stream/promises': streams,
      'node:zlib': zlib,
      yazl: yazl,
      yauzl: yauzl,
      'tar-stream': { extract: tar.extract },
      '../database/index.js': {
        fileTransferJobRepository: repo,
        serverRepository: { findById: async () => ({}) },
      },
      '../database/repositories/fileTransferJobRepository.js': {
        parsePayload: () => ({}),
        serializeFileTransferJob: (row: any) => ({ ...row }),
      },
      '../utils/fsBrowser.js': browser,
      '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
      '../providers/runtimeConfig.js': {
        getRuntimeOwnership: () => ({ uid: process.getuid!(), gid: process.getgid!() }),
      },
      './fileExplorer.js': {
        resolveServerPath: async (p: any) => ({
          root: 'data',
          rootDir: data,
          ...browser.resolveSafeChildPath(data, p.path),
        }),
        assertPublicServerPath: async () => {},
      },
      '../utils/logger.js': { logError: () => {} },
      '../utils/time.js': { nowIso: () => new Date().toISOString() },
      './nativeOperationLock.js': locks,
      './extractionTransaction.js': transaction,
    },
    { process, Buffer, console }
  );
  async function make(invalid: boolean) {
    const pack = tar.pack();
    const output = streams.pipeline(
      pack,
      filesystem.createWriteStream(path.join(data, 'package.tar'))
    );
    pack.entry({ name: 'a' }, 'new-a');
    pack.entry({ name: invalid ? '../escape' : 'sub/b' }, 'new-b');
    pack.finalize();
    await output;
  }
  async function wait(id: number) {
    for (let i = 0; i < 100 && !['failed', 'completed'].includes(rows.get(id).status); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    return rows.get(id);
  }
  try {
    await fs.mkdir(data);
    await fs.writeFile(path.join(data, 'a'), 'old-a');
    await make(true);
    const first = await transfers.startArchiveExtraction({
      serverId: 93,
      path: '/package.tar',
      dest: '/',
      overwrite: true,
      deleteArchive: false,
    });
    assert.throws(() => locks.enterServerMutation(93), /running/);
    assert.equal((await wait(first.id)).status, 'failed');
    assert.equal(await fs.readFile(path.join(data, 'a'), 'utf8'), 'old-a');
    await make(false);
    const second = await transfers.startArchiveExtraction({
      serverId: 93,
      path: '/package.tar',
      dest: '/',
      overwrite: true,
      deleteArchive: false,
    });
    const result = await wait(second.id);
    assert.equal(result.status, 'completed', result.error);
    assert.equal(await fs.readFile(path.join(data, 'sub/b'), 'utf8'), 'new-b');
    assert.equal(await fs.readFile(path.join(data, 'a'), 'utf8'), 'new-a');
  } finally {
    locks.unblockNativeServer(93);
    await fs.rm(root, { recursive: true, force: true });
  }
});
