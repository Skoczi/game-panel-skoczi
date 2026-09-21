import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getServerStoragePaths } from '../utils/storage.js';
import { acquireNativeOperation } from './nativeOperationLock.js';
import { syncDirectory } from './nativeRestoreJournal.js';
import { actionsRepository } from '../database/index.js';
export type BackupJob = {
  id: string;
  kind: 'backup' | 'restore';
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  actor?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  result?: { ok: boolean; exitCode: number; stdout?: string; stderr?: string };
};
const directory = (serverId: number) =>
  path.join(getServerStoragePaths(serverId).serverRoot, '.backup-jobs');
async function save(serverId: number, job: BackupJob) {
  const dir = directory(serverId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const filename = path.join(dir, `${job.id}.json`);
  const temporary = filename + '.tmp';
  const handle = await fs.open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(job));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filename);
  await syncDirectory(dir);
}
export async function listBackupJobs(serverId: number): Promise<BackupJob[]> {
  const files = await fs.readdir(directory(serverId)).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const jobs = await Promise.all(
    files
      .filter((name) => /^[0-9a-f-]+\.json$/.test(name))
      .map(
        async (name) =>
          JSON.parse(await fs.readFile(path.join(directory(serverId), name), 'utf8')) as BackupJob
      )
  );
  return jobs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100);
}
export async function readBackupJob(serverId: number, id: string): Promise<BackupJob> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id))
    throw Object.assign(new Error('Invalid operation id'), { statusCode: 400 });
  try {
    return JSON.parse(await fs.readFile(path.join(directory(serverId), `${id}.json`), 'utf8'));
  } catch (error: any) {
    if (error.code === 'ENOENT')
      throw Object.assign(new Error('Operation not found'), { statusCode: 404 });
    throw error;
  }
}
export async function recoverBackupJobs(serverId: number) {
  for (const job of await listBackupJobs(serverId))
    if (job.status === 'running') {
      await save(serverId, {
        ...job,
        status: 'interrupted',
        completedAt: new Date().toISOString(),
        error:
          'Agent restarted before completion was recorded. Inspect backup/recovery results before retrying.',
      });
    }
}
export async function startBackupJob(
  serverId: number,
  kind: BackupJob['kind'],
  actor: string,
  run: () => Promise<NonNullable<BackupJob['result']>>
) {
  const release = acquireNativeOperation(serverId, true);
  const job: BackupJob = {
    id: randomUUID(),
    kind,
    actor,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  try {
    await save(serverId, job);
  } catch (error) {
    release();
    throw error;
  }
  void (async () => {
    try {
      const result = await run();
      if (!result.ok) throw new Error(result.stderr || 'Backup operation failed');
      await save(serverId, {
        ...job,
        status: 'completed',
        completedAt: new Date().toISOString(),
        result,
      });
      await actionsRepository
        .create(serverId, 'success', `${kind} completed (${job.id})`, actor)
        .catch((error) => console.error('Backup activity log failed', job.id, error));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup operation failed';
      await save(serverId, {
        ...job,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: message,
      });
      await actionsRepository.create(serverId, 'error', `${kind} failed: ${message}`, actor);
    } finally {
      release();
    }
  })().catch((error) => {
    console.error('Unable to persist backup job result', job.id, error);
  });
  return job;
}
