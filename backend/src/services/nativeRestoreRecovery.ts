import { recoverExtraction, hasExtractionTransaction } from './extractionTransaction.js';
import { recoverBackupJobs } from './backupJobs.js';
import { serverRepository, actionsRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { hasRestoreJournal, rollbackInterruptedRestore } from './nativeRestoreJournal.js';
import { blockNativeServer } from './nativeOperationLock.js';
import { logError } from '../utils/logger.js';
export async function recoverRestoreTransactions() {
  for (const server of await serverRepository.listAll()) {
    try {
      await recoverBackupJobs(server.id);
      const restore = await hasRestoreJournal(server.id);
      const extraction = await hasExtractionTransaction(server.id);
      if (!restore && !extraction) continue;
      blockNativeServer(server.id, 'Interrupted restore requires recovery');
      if (server.docker_container_id) {
        const container = docker.getContainer(server.docker_container_id);
        const info = await container.inspect().catch((error: any) => {
          if (error.statusCode === 404) return null;
          throw error;
        });
        if (info?.State.Running) await container.stop({ t: 30 });
      }
      if (extraction) await recoverExtraction(server.id);
      if (restore) await rollbackInterruptedRestore(server.id);
      await serverRepository.updateDesiredState(server.id, 'stopped');
      await actionsRepository.create(
        server.id,
        'info',
        'Interrupted file operation rolled back to previous files. Server remains stopped.',
        'recovery'
      );
    } catch (error) {
      blockNativeServer(
        server.id,
        'Restore recovery failed. Inspect the recovery journal before changing this server.'
      );
      logError('NATIVE:RESTORE:RECOVERY', error, { serverId: server.id });
    }
  }
}
