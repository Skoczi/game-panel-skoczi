import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';
test('API backup dispatch reuses Native jobs, releases the request lock and binds remote requests to one runtime', async () => {
    let native = true, identity = 'identity', locks = 0, backups = 0, starts = 0;
    const calls: any[] = [];
    const service = loadWithMocks('../src/services/publicApiBackupOperations.ts', {
        './apiRuntimeTransport.js': { readApiRuntime: async (...args: any[]) => {
            calls.push(args);
            return { job: { id: '11111111-1111-4111-8111-111111111111', kind: 'backup', status: 'completed',
                startedAt: new Date().toISOString(), result: { stdout: '/private/secret' } } };
        } },
        './servers.js': { getServerOrThrow: async () => ({ id: 7, runtime_uuid: identity }) },
        './nativeBackups.js': { nativeServerTemplate: () => native ? {} : null,
            createNativeBackup: async (_server: unknown, held: boolean, name: string) => {
                assert(held); assert.equal(name, 'Before update'); backups++; return { ok: true, exitCode: 0 };
            } },
        './backupJobs.js': { startBackupJob: async (_id: number, kind: string, actor: string, run: () => Promise<unknown>) => {
            assert.equal(kind, 'backup'); assert.equal(actor, 'api-user:3'); starts++; await run(); return { id: 'job' };
        }, readBackupJob: async () => ({ id: 'job', kind: 'backup', status: 'completed', startedAt: new Date().toISOString(), error: 'private path' }) },
        './nativeOperationLock.js': { enterServerMutation: () => { locks++; return () => { locks--; }; } },
        '../database/index.js': { actionsRepository: { create: async () => {} } },
    });
    const row = { node_id: 'local', runtime_id: 7, runtime_key: 'identity' };
    assert.equal(await service.startApiBackup(row, 3, 'operation', 'Before update'), 'job');
    assert.equal(locks, 0); assert.equal(backups, 1);
    native = false; await assert.rejects(service.startApiBackup(row, 3, 'operation', 'Before update'));
    assert.equal(locks, 0); assert.equal(starts, 1);
    native = true; identity = 'replacement'; await assert.rejects(service.startApiBackup(row, 3, 'operation', 'Before update'));
    assert.equal(locks, 0); assert.equal(starts, 1);
    const remote = { ...row, node_id: 'remote' };
    await service.startApiBackup(remote, 3, 'stable-operation-key', 'Before update');
    assert.equal(calls[0][2], 'backups/create-native'); assert.deepEqual([...calls[0][3]], ['backups.create']);
    assert.deepEqual({ ...calls[0][5] }, { name: 'Before update', key: 'stable-operation-key' });
    const status = await service.readApiBackupJob(remote, 3, '11111111-1111-4111-8111-111111111111');
    assert.equal(status.status, 'completed'); assert(!JSON.stringify(status).includes('private'));
});
