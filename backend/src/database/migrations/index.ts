import { migration as scheduledGameCommands } from './0005_scheduled_game_commands.js';
import { migration as resourceMetrics } from './0004_resource_metrics.js';
import type { DatabaseMigration } from './types.js';
import { migration as fileTransferJobsAddExtractKind } from './0001_file_transfer_jobs_add_extract_kind.js';
import { migration as serverRuntimeIdentity } from './0002_server_runtime_identity.js';
import { migration as nativeInstallProgress } from './0003_native_install_progress.js';

export const DATABASE_MIGRATIONS: DatabaseMigration[] = [
  fileTransferJobsAddExtractKind,
  serverRuntimeIdentity,
  nativeInstallProgress,
  resourceMetrics,
  scheduledGameCommands,
];
