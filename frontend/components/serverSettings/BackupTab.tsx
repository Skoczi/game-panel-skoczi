import { NativeRetentionPanel } from './NativeRetentionPanel';
import { NativeProtectionCard } from './NativeProtectionCard';
import { AppSectionHeader } from '../../src/ui/layout';
import { OperationList } from './OperationList';
import { apiClient, type BackupJob } from '../../utils/api';
import { useEffect, useState } from 'react';
import { AppButton, AppInput, AppSlider, AppToggle } from '../../src/ui/components';
import {
  AlertTriangle,
  Calendar,
  Check,
  Download,
  HardDrive,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';

interface BackupItem {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

interface BackupTabProps {
  serverId: number;
  serverStatus?: string | null;
  native?: boolean;
  contentBg: string;
  borderColor: string;
  hoverBg: string;
  inputBg: string;
  inputBorder: string;
  textPrimary: string;
  textSecondary: string;
  serverName: string;
  handleBackupNow: () => void;
  canCreateBackups: boolean;
  backupNowLoading: boolean;
  backupSettingsError: string | null;
  backupRetention: number;
  setBackupRetention: (value: number) => void;
  backupRetentionDays: number;
  setBackupRetentionDays: (value: number) => void;
  stopOnBackup: boolean;
  setStopOnBackup: (value: boolean) => void;
  handleSaveBackupSettings: () => void;
  canEditBackupSettings: boolean;
  backupSaving: boolean;
  backupSettingsLoading: boolean;
  loadBackups: () => void;
  backupsError: string | null;
  backupsLoading: boolean;
  backups: BackupItem[];
  formatBytes: (bytes: number) => string;
  handleDownloadBackup: (backup: BackupItem) => void;
  canDownloadBackups: boolean;
  backupDownloadLoading: string | null;
  handleDeleteBackup: (backup: BackupItem) => void;
  canDeleteBackups: boolean;
  backupDeleteLoading: string | null;
  handleRestoreBackup: (backup: BackupItem) => void;
  canRestoreBackups: boolean;
  backupRestoreLoading: string | null;
  handleRenameBackup: (backup: BackupItem, newName: string) => Promise<void>;
  canRenameBackups: boolean;
  backupRenameLoading: string | null;
  isLinuxGSMGame: boolean;
  backupsNotSupported: boolean;
  hideManualBackup?: boolean;
}

export function BackupTab({
  serverId,
  serverStatus,
  contentBg,
  borderColor,
  hoverBg,
  inputBg: _inputBg,
  inputBorder: _inputBorder,
  textPrimary,
  textSecondary,
  handleBackupNow,
  canCreateBackups,
  backupNowLoading,
  backupSettingsError,
  backupRetention,
  setBackupRetention,
  backupRetentionDays,
  setBackupRetentionDays,
  stopOnBackup,
  setStopOnBackup,
  handleSaveBackupSettings,
  canEditBackupSettings,
  backupSaving,
  backupSettingsLoading,
  loadBackups,
  backupsError,
  backupsLoading,
  backups,
  formatBytes,
  handleDownloadBackup,
  canDownloadBackups,
  backupDownloadLoading,
  handleDeleteBackup,
  canDeleteBackups,
  backupDeleteLoading,
  handleRestoreBackup,
  canRestoreBackups,
  backupRestoreLoading,
  handleRenameBackup,
  canRenameBackups,
  backupRenameLoading,
  isLinuxGSMGame,
  backupsNotSupported,
  hideManualBackup = false,
  native = false,
}: BackupTabProps) {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [jobsKnown, setJobsKnown] = useState(false);
  const [compatibilityError, setCompatibilityError] = useState(false);
  const [compatibilityCheck, setCompatibilityCheck] = useState(0);
  const [compatibility, setCompatibility] = useState<Awaited<ReturnType<typeof apiClient.backupCompatibility>>>();
  useEffect(() => {
    setCompatibility(undefined);
    setCompatibilityError(false);
    setJobs([]);
    setJobsKnown(false);
    setJobsError('');
    if (!native) return;
    let active = true;
    const refresh = async () => {
      try { const result = await apiClient.listBackupJobs(serverId); if (active) { setJobs(result); setJobsKnown(true); setJobsError(''); } }
      catch { if (active) setJobsError('Unable to refresh operation status. Refresh before retrying an operation.'); }
    };
    void apiClient.backupCompatibility(serverId).then(result => { if(active) setCompatibility(result); }).catch(() => { if (active) setCompatibilityError(true); });
    void refresh(); const timer = setInterval(refresh, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [serverId, native, compatibilityCheck]);
  const nativeReady = !native || (compatibility?.capabilities?.backupJobs === 1 && compatibility?.capabilities?.nativeRestoreRecovery === 1 && compatibility.layoutReady);
  const operationReason = !nativeReady ? 'Check runtime compatibility before changing backups.'
    : native && (!jobsKnown || Boolean(jobsError)) ? 'Wait for a confirmed operation status before starting another action.'
    : backupNowLoading || backupRestoreLoading !== null || jobs.some(job => job.status === 'running') ? 'Another backup operation is running.' : '';
  const createReason = !canCreateBackups ? 'You do not have permission to create backups.' : operationReason;
  const restoreReason = !canRestoreBackups ? 'You do not have permission to restore backups.' : operationReason
    || (native && !['stopped', 'exited', 'created', 'dead'].includes(serverStatus || '') ? 'Stop the server before restoring a Native backup.' : '');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = (backup: BackupItem) => {
    setRenamingPath(backup.path);
    setRenameValue(backup.name);
  };

  const cancelRename = () => setRenamingPath(null);

  const confirmRename = async (backup: BackupItem) => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === backup.name) { setRenamingPath(null); return; }
    await handleRenameBackup(backup, trimmed);
    setRenamingPath(null);
  };

  const toggleRowClass = `p-4 rounded-lg border ${borderColor} bg-gray-50 dark:bg-gray-900/30 flex items-center justify-between gap-4`;

  return (
    <div className="gp-server-tab-body h-full overflow-y-auto p-4 sm:p-5">
      <div className="gp-server-settings-body max-w-4xl mx-auto space-y-4 sm:space-y-6">

        <AppSectionHeader className="gp-server-tab-header" title="Backups" actions={<>
          {!backupsNotSupported && !hideManualBackup && (
            <AppButton
              tone="primary"
              onClick={handleBackupNow}
              disabled={Boolean(createReason)}
              title={createReason || undefined}
              aria-describedby={createReason ? `backup-create-reason-${serverId}` : undefined}
              className="flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60 w-full sm:w-auto flex-shrink-0"
            >
              <Download className="w-5 h-5" />
              <span>{backupNowLoading ? 'Creating backup...' : 'Create backup now'}</span>
            </AppButton>
          )}
        </>} />
        {createReason && !hideManualBackup && <p id={`backup-create-reason-${serverId}`} className={`text-sm ${textSecondary}`}>{createReason}</p>}
        {native && restoreReason && <p id={`backup-restore-reason-${serverId}`} className="sr-only">Restore: {restoreReason}</p>}

        {native && !nativeReady && <p role="status" className="text-sm text-amber-500">{!compatibility ? (compatibilityError ? 'Runtime compatibility could not be checked. Check the node connection and agent version before creating or restoring backups.' : 'Checking runtime compatibility…') : !compatibility.layoutReady ? 'Native backup actions require the serverfiles layout.' : 'Update this node’s agent to enable persistent backup jobs and safe restore recovery.'}</p>}
        {native && (!nativeReady || Boolean(jobsError)) && <AppButton onClick={() => setCompatibilityCheck(value => value + 1)}>Recheck runtime</AppButton>}
        {native && compatibility && !compatibility.layoutReady && <p role="alert" className="text-sm text-amber-500">This server uses a legacy data layout. Move to the serverfiles layout with a reviewed migration before creating or restoring Native backups. Existing files have not been moved.</p>}
        {native && compatibility && compatibility.legacy.length > 0 && <details className={`rounded-xl border ${borderColor} p-4 text-sm space-y-2`} aria-label="Legacy backups">
          <summary className="cursor-pointer font-medium">Legacy archives ({compatibility.legacy.length})</summary><p className={textSecondary}>Download only — this format cannot be restored here.</p>
          {compatibility.legacy.map(item => <div key={item.name} className="flex items-center justify-between gap-2"><span className="truncate">{item.name}</span><AppButton disabled={!canDownloadBackups} onClick={() => { void apiClient.downloadLegacyBackup(serverId,item.name).catch(() => setJobsError('Legacy archive download failed.')); }}>Download</AppButton></div>)}
        </details>}
        {native && jobsError && <p role="alert" className="text-sm text-amber-500">{jobsError}</p>}
        {backupsNotSupported && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-sm font-medium ${textPrimary}`}>Backups not supported</p>
              <p className={`text-xs ${textSecondary} mt-1`}>
                This server type does not support backups.
              </p>
            </div>
          </div>
        )}

        {isLinuxGSMGame && (
          <div className={`${contentBg} border ${borderColor} rounded-lg p-4 sm:p-5 space-y-6 sm:space-y-5`}>
            <h4 className={`text-lg font-semibold ${textPrimary}`}>Retention Policy</h4>
            {backupSettingsError && <div className="text-sm text-red-400">{backupSettingsError}</div>}
            <div className="space-y-5">
              <div className={`p-4 rounded-lg border ${borderColor} bg-gray-50 dark:bg-gray-900/30 space-y-3`}>
                <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-start">
                  <label className={`block text-sm font-medium ${textPrimary}`}>Keep the last backups</label>
                  <span className="text-sm font-semibold text-[var(--color-cyan-400)] text-right">
                    {backupRetention === 0 ? 'Unlimited' : `${backupRetention} backups`}
                  </span>
                  <p className={`text-xs ${textSecondary} col-span-2`}>Set 0 to keep all backups.</p>
                  <div className="col-span-2">
                    <AppSlider
                      min={0} max={30} value={backupRetention}
                      onChange={(e) => setBackupRetention(parseInt(e.target.value) || 0)}
                    />
                    <div className={`mt-2 grid grid-cols-3 items-center text-[11px] ${textSecondary}`}>
                      <span className="text-left">0</span>
                      <span className={`text-center text-xs font-semibold ${textPrimary}`}>
                        {backupRetention === 0 ? 'Unlimited' : backupRetention}
                      </span>
                      <span className="text-right">30</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={`p-4 rounded-lg border ${borderColor} bg-gray-50 dark:bg-gray-900/30 space-y-3`}>
                <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-start">
                  <label className={`block text-sm font-medium ${textPrimary}`}>Keep backups for days</label>
                  <span className="text-sm font-semibold text-[var(--color-cyan-400)] text-right">
                    {backupRetentionDays === 0 ? 'Unlimited' : `${backupRetentionDays} days`}
                  </span>
                  <p className={`text-xs ${textSecondary} col-span-2`}>Set 0 to keep backups forever.</p>
                  <div className="col-span-2">
                    <AppSlider
                      min={0} max={90} value={backupRetentionDays}
                      onChange={(e) => setBackupRetentionDays(parseInt(e.target.value) || 0)}
                    />
                    <div className={`mt-2 grid grid-cols-3 items-center text-[11px] ${textSecondary}`}>
                      <span className="text-left">0</span>
                      <span className={`text-center text-xs font-semibold ${textPrimary}`}>
                        {backupRetentionDays === 0 ? 'Unlimited' : backupRetentionDays}
                      </span>
                      <span className="text-right">90</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={toggleRowClass}>
                <div>
                  <p className={`text-sm font-medium ${textPrimary}`}>Stop server before backup</p>
                  <p className={`text-xs ${textSecondary}`}>Recommended for consistent saves.</p>
                </div>
                <AppToggle
                  ariaLabel="Stop server before backup"
                  checked={stopOnBackup}
                  size="standard"
                  onChange={setStopOnBackup}
                  className="flex-shrink-0"
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <AppButton
                tone="primary"
                onClick={handleSaveBackupSettings}
                disabled={!canEditBackupSettings || backupSaving || backupSettingsLoading}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium w-full sm:w-auto flex-shrink-0 disabled:opacity-60"
              >
                <Save className="w-5 h-5" />
                <span>{backupSaving ? 'Saving...' : 'Save retention settings'}</span>
              </AppButton>
            </div>
          </div>
        )}

        {!backupsNotSupported && (
          <div className={`${contentBg} border ${borderColor} rounded-lg p-4 sm:p-5 space-y-3 sm:space-y-4`}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
              <div>
                <h4 className={`text-lg font-semibold ${textPrimary} mb-1`}>Available Backups</h4>
              </div>
              <AppButton
                onClick={() => loadBackups()}
                className="flex items-center justify-center gap-2 px-3 py-2 rounded text-sm transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white w-full sm:w-auto"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </AppButton>
            </div>

            {backupsError && <div role="alert" className="text-sm text-red-400">{backupsError}</div>}

            <div className="space-y-3">
              {backupsLoading && <div className={`text-sm ${textSecondary}`}>Loading backups...</div>}
              {!backupsLoading && !backupsError && backups.length === 0 && (
                <div className={`text-sm ${textSecondary}`}>No backups found.</div>
              )}
              {!backupsLoading && backups.map((backup) => (
                <div
                  key={backup.path}
                  className={`border ${borderColor} rounded-lg p-3 md:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between transition-colors ${hoverBg}`}
                >
                  <div className="flex items-center gap-3 md:gap-4 min-w-0 flex-1">
                    <div className="p-2 md:p-3 bg-[#0050D7]/10 rounded flex-shrink-0">
                      <HardDrive className="w-5 h-5 md:w-6 md:h-6 text-[var(--color-cyan-400)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {renamingPath === backup.path ? (
                        <div className="flex items-center gap-2 mb-1">
                          <AppInput
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            disabled={backupRenameLoading === backup.name}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void confirmRename(backup);
                              if (e.key === 'Escape') cancelRename();
                            }}
                            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[var(--color-cyan-400)]"
                          />
                          <AppButton
                            onClick={() => void confirmRename(backup)}
                            disabled={backupRenameLoading === backup.name || !renameValue.trim()}
                            className="p-1 rounded text-green-500 hover:bg-green-500/10 disabled:opacity-40"
                          >
                            <Check className="w-4 h-4" />
                          </AppButton>
                          <AppButton
                            onClick={cancelRename}
                            disabled={backupRenameLoading === backup.name}
                            className="p-1 rounded text-gray-400 hover:bg-gray-500/10 disabled:opacity-40"
                          >
                            <X className="w-4 h-4" />
                          </AppButton>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mb-1">
                          <h5 className={`font-medium ${textPrimary} text-sm md:text-base break-words`}>
                            {backup.name}
                          </h5>
                          {canRenameBackups && (
                            <AppButton
                              onClick={() => startRename(backup)}
                              className="p-1 rounded text-gray-400 hover:text-[var(--color-cyan-400)] hover:bg-[var(--color-cyan-400)]/10 flex-shrink-0"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </AppButton>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-3 md:gap-4 text-xs text-gray-500 flex-wrap">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <span className="whitespace-nowrap">
                            {new Date(backup.modifiedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3" />
                          {formatBytes(backup.size)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                    <AppButton
                      tone="neutral"
                      onClick={() => handleDownloadBackup(backup)}
                      disabled={!canDownloadBackups || backupDownloadLoading === backup.name}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 whitespace-nowrap w-full sm:w-auto"
                    >
                      <Download className="w-4 h-4" />
                      {backupDownloadLoading === backup.name ? 'Downloading...' : 'Download'}
                    </AppButton>
                    {canRestoreBackups && !isLinuxGSMGame && (
                      <AppButton
                        tone="ghost"
                        onClick={() => handleRestoreBackup(backup)}
                        disabled={Boolean(restoreReason)}
                        title={restoreReason || undefined}
                        aria-describedby={native && restoreReason ? `backup-restore-reason-${serverId}` : undefined}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 whitespace-nowrap w-full sm:w-auto border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <RotateCcw className="w-4 h-4" />
                        {backupRestoreLoading === backup.name ? 'Restoring...' : 'Restore'}
                      </AppButton>
                    )}
                    <AppButton
                      tone="critical"
                      onClick={() => handleDeleteBackup(backup)}
                      disabled={!canDeleteBackups || backupDeleteLoading === backup.name}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 whitespace-nowrap w-full sm:w-auto"
                    >
                      <Trash2 className="w-4 h-4" />
                      {backupDeleteLoading === backup.name ? 'Deleting...' : 'Delete'}
                    </AppButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {native && jobs.length > 0 && <div className={`rounded-xl border ${borderColor} p-4`}>
          <OperationList label="Backup operations" secondaryClass={textSecondary} operations={jobs.slice(0, 5).map(job => ({
            ...job, name: job.kind === 'restore' ? 'Restore' : 'Backup',
          }))} />
        </div>}
        {native && canDeleteBackups && compatibility?.capabilities?.nativeRetention === 1 && <NativeRetentionPanel key={serverId} serverId={serverId} onChanged={() => { void loadBackups(); }} />}

        {native && <NativeProtectionCard serverId={serverId} supported={compatibility?.capabilities?.nativeProtection === 1} checking={!compatibility && !compatibilityError} />}

      </div>
    </div>
  );
}
