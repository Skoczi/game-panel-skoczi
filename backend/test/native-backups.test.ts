import { withStorageReserve } from '../src/services/storageReserve.js';
import { validateNativeArchive } from '../src/services/nativeArchive.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadWithMocks } from './loadWithMocks.js';
import { rejectPrivateFileRoots } from '../src/middleware/privateFileRoots.js';

test('native backups include game files and FastDownload uploads without following symlinks, online and offline', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-native-backup-test-'));
    let status = 'running'; let released = 0;
    const module = loadWithMocks('../src/services/nativeBackups.ts', {
        './nativeProtection.js': { recordNativeBackup: async () => ({}) },
        './nativeBackupPolicy.js': { readNativeBackupPolicy: async () => ({ automaticRetention: false, externalCopy: false }) },
        './finishNativeBackup.js': { finishNativeBackup: async () => '' },
        './storageReserve.js': { withStorageReserve },
        './nativeRestoreJournal.js': { syncDirectory: async () => {} },
        './nativeArchive.js': { validateNativeArchive },
        'node:fs': { promises: fs }, 'node:path': path, 'node:child_process': { execFile },
        'node:util': { promisify }, 'node:crypto': { randomUUID },
        '../templates/nativeContract.js': { nativeTemplate: () => ({ mounts: [{ key: 'data' }, { key: 'config' }] }) },
        '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
        '../utils/docker.js': { checkContainerStatus: async () => status },
        './nativeOperationLock.js': { acquireNativeOperation: () => () => { released++; } },
    }, { process, Buffer });
    try {
        await fs.mkdir(path.join(root, 'data', 'serverfiles'), { recursive: true }); await fs.mkdir(path.join(root, 'config'));
        await fs.writeFile(path.join(root, 'data', 'serverfiles', 'server.cfg'), 'hostname test');
        await fs.writeFile(path.join(root, 'config', 'settings.ini'), 'test=1');
        await fs.mkdir(path.join(root,'data','fastdownload'));await fs.writeFile(path.join(root,'data','fastdownload','manual.bsp'),'manual');
        await fs.symlink('server.cfg', path.join(root, 'data', 'serverfiles', 'inside'));
        await fs.symlink('libSDL2-2.0.so.0', path.join(root, 'data', 'serverfiles', 'libSDL2.so'));
        const server = { id: 1, provider_metadata_json: '{}', docker_container_id: 'test' };
        assert.match((await module.createNativeBackup(server, false, 'Przed aktualizacją')).stdout, /Przed-aktualizacją/);
        for (const name of ['../escape', '/absolute', 'bad\\name', 'bad\nname', 'a'.repeat(65), '界'.repeat(64)]) assert.throws(() => module.normalizeBackupName(name));
        assert.equal(module.normalizeBackupName('  Before update.tar.gz  '), 'Before-update');
        assert.equal(module.normalizeBackupName(''), '');
        status = 'restarting'; await assert.rejects(module.createNativeBackup(server), /finishes its current transition/);
        status = 'exited'; assert.equal((await module.createNativeBackup(server)).ok, true);
        const directory = path.join(root, 'data', 'backups');
        const names = await fs.readdir(directory); assert.equal(names.length, 2);
        assert(names[0].endsWith('.tar.gz'));
        const archive = path.join(directory, names[0]);
        assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);
        const { stdout } = await promisify(execFile)('tar', ['-tzf', archive]);
        assert(stdout.includes('serverfiles/libSDL2.so')); assert(!stdout.includes('serverfiles/libSDL2-2.0.so.0'));
        assert(stdout.includes('fastdownload/manual.bsp'));assert(stdout.includes('serverfiles/server.cfg')); assert(!stdout.includes('config/settings.ini')); assert(!stdout.includes('backups/'));
        assert(!stdout.includes('outside/passwd')); assert(!stdout.includes('.native-backups'));
        await fs.symlink('/etc', path.join(root, 'data', 'serverfiles', 'outside'));
        await assert.rejects(module.createNativeBackup(server), /external link/);
        assert.equal((await fs.readdir(directory)).length, 2);
        assert.equal(released, 4);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('file API cannot bypass backup permissions using a private root', () => {
    for (const value of ['native-backups', ' native-backups ', ['native-backups']]) for (const source of ['query', 'body']) for (const key of ['root', 'fromRoot', 'toRoot']) {
        let code = 0; let continued = false;
        const response = { status: (value: number) => { code = value; return response; }, json: () => {} };
        rejectPrivateFileRoots({ [source]: { [key]: value } } as any, response as any, () => { continued = true; });
        assert.equal(code, 403); assert.equal(continued, false);
    }
});

test('failed native backup removes partial output and releases its operation lock for retry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-native-backup-failure-'));
    let released = 0; let fail = true;
    const module = loadWithMocks('../src/services/nativeBackups.ts', {
        './nativeProtection.js': { recordNativeBackup: async () => ({}) },
        './nativeBackupPolicy.js': { readNativeBackupPolicy: async () => ({ automaticRetention: false, externalCopy: false }) },
        './finishNativeBackup.js': { finishNativeBackup: async () => '' },
        './storageReserve.js': { withStorageReserve },
        './nativeRestoreJournal.js': { syncDirectory: async () => {} },
        './nativeArchive.js': { validateNativeArchive: async () => {} },
        'node:fs': { promises: fs }, 'node:path': path, 'node:child_process': { execFile },
        'node:util': { promisify: () => async (_command: string, args: string[]) => {
            await fs.writeFile(args[1], 'partial archive');
            if (fail) throw new Error('simulated disk full');
        } },
        'node:crypto': { randomUUID },
        '../templates/nativeContract.js': { nativeTemplate: () => ({ mounts: [{ key: 'data' }] }) },
        '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
        '../utils/docker.js': { checkContainerStatus: async () => 'exited' },
        './nativeOperationLock.js': { acquireNativeOperation: () => () => { released++; } },
    }, { process, Buffer });
    try {
        await fs.mkdir(path.join(root, 'data', 'serverfiles'), { recursive: true });
        const server = { id: 2, provider_metadata_json: '{}', docker_container_id: 'test' };
        await assert.rejects(module.createNativeBackup(server), /simulated disk full/);
        assert.deepEqual(await fs.readdir(path.join(root, 'data', 'backups')), []);
        assert.equal(released, 1);
        fail = false;
        assert.equal((await module.createNativeBackup(server)).ok, true);
        assert.equal(released, 2);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('native backups reject symlinked archive directories and mount roots', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-native-backup-links-'));
    let released = 0;
    const module = loadWithMocks('../src/services/nativeBackups.ts', {
        './nativeProtection.js': { recordNativeBackup: async () => ({}) },
        './nativeBackupPolicy.js': { readNativeBackupPolicy: async () => ({ automaticRetention: false, externalCopy: false }) },
        './finishNativeBackup.js': { finishNativeBackup: async () => '' },
        './storageReserve.js': { withStorageReserve },
        './nativeRestoreJournal.js': { syncDirectory: async () => {} },
        './nativeArchive.js': { validateNativeArchive },
        'node:fs': { promises: fs }, 'node:path': path, 'node:child_process': { execFile },
        'node:util': { promisify }, 'node:crypto': { randomUUID },
        '../templates/nativeContract.js': { nativeTemplate: () => ({ mounts: [{ key: 'data' }] }) },
        '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
        '../utils/docker.js': { checkContainerStatus: async () => 'exited' },
        './nativeOperationLock.js': { acquireNativeOperation: () => () => { released++; } },
    }, { process, Buffer });
    try {
        await fs.mkdir(path.join(root, 'outside'));
        await fs.mkdir(path.join(root, 'data'));
        await fs.symlink(path.join(root, 'outside'), path.join(root, 'data', 'backups'));
        const server = { id: 3, provider_metadata_json: '{}', docker_container_id: 'test' };
        await assert.rejects(module.createNativeBackup(server), /Invalid native backup directory/);
        await fs.unlink(path.join(root, 'data', 'backups'));
        await fs.symlink(path.join(root, 'outside'), path.join(root, 'data', 'serverfiles'));
        await assert.rejects(module.createNativeBackup(server), /Invalid native data mount/);
        assert.deepEqual(await fs.readdir(path.join(root, 'outside')), []);
        assert.equal(released, 2);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
