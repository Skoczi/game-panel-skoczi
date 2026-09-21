import type { FleetRow } from '../fleet/store.js';
import { readApiRuntime } from './apiRuntimeTransport.js';
import { getServerOrThrow } from './servers.js';
import { nativeServerTemplate, createNativeBackup } from './nativeBackups.js';
import { startBackupJob, readBackupJob } from './backupJobs.js';
import { enterServerMutation } from './nativeOperationLock.js';
import { actionsRepository } from '../database/index.js';

export async function startApiBackup(row: FleetRow, actorId: number, operationId: string, name: string): Promise<string> {
    if (row.node_id !== 'local') {
        const result = await readApiRuntime(row, actorId, 'backups/create-native', ['backups.create'], 16384,
            { name, key: operationId }) as any;
        if (!result?.job || result.job.kind !== 'backup' || !/^[0-9a-f-]{36}$/.test(result.job.id))
            throw new Error('Invalid backup admission response');
        return result.job.id;
    }
    const release = enterServerMutation(row.runtime_id);
    try {
        const server = await getServerOrThrow(row.runtime_id);
        if (server.runtime_uuid !== row.runtime_key || !nativeServerTemplate(server)) throw new Error('Native runtime changed or unavailable');
        await actionsRepository.create(server.id, 'info', 'API backup requested', `api-user:${actorId}`);
        const job = await startBackupJob(server.id, 'backup', `api-user:${actorId}`, () => createNativeBackup(server, true, name));
        return job.id;
    } finally { release(); }
}

export async function readApiBackupJob(row: FleetRow, actorId: number, jobId: string) {
    const job = row.node_id === 'local' ? await readBackupJob(row.runtime_id, jobId)
        : (await readApiRuntime(row, actorId, `backups/jobs/${jobId}`, ['backups.create']) as any)?.job;
    if (!job || job.kind !== 'backup' || job.id !== jobId || !['running', 'completed', 'failed', 'interrupted'].includes(job.status))
        throw new Error('Invalid backup operation response');
    // Runtime output and paths are internal. Expose only stable status and times.
    const iso = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    return { status: job.status as string, startedAt: iso(job.startedAt), completedAt: iso(job.completedAt) };
}
