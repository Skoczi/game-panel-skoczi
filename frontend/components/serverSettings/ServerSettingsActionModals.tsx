import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AppButton, AppInput, AppModal, AppModalContent, AppModalHeader, AppModalTitle, AppModalBody } from '../../src/ui/components';

interface DeleteEntryTarget {
  name: string;
  type: 'file' | 'folder' | 'symlink';
}

interface ServerSettingsActionModalsProps {
  modalBg: string;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
  hoverBg: string;
  inputBg: string;
  inputBorder: string;
  showCreateEntryModal: boolean;
  createEntryType: 'file' | 'folder';
  createEntryName: string;
  createEntryError: string | null;
  createEntryLoading: boolean;
  setCreateEntryName: (value: string) => void;
  clearCreateEntryError: () => void;
  closeCreateEntryModal: () => void;
  submitCreateEntry: () => Promise<void> | void;
  showDeleteEntryModal: boolean;
  deleteEntryTarget: DeleteEntryTarget | null;
  deleteMultiNames?: string[] | null;
  deleteEntryLoading: boolean;
  closeDeleteEntryModal: () => void;
  confirmDeleteEntry: () => Promise<void> | void;
  showBackupNowWarningModal: boolean;
  backupNowLoading: boolean;
  stopOnBackup: boolean;
  hotBackupOnly?: boolean;
  nativeBackup?: boolean;
  closeBackupWarningModal: () => void;
  executeBackupNow: (name?: string) => Promise<void>;
}

import { useBodyScrollLock } from '../../src/ui/utils/useBodyScrollLock';

export function ServerSettingsActionModals({
  modalBg,
  borderColor,
  textPrimary,
  textSecondary,
  hoverBg,
  inputBg,
  inputBorder,
  showCreateEntryModal,
  createEntryType,
  createEntryName,
  createEntryError,
  createEntryLoading,
  setCreateEntryName,
  clearCreateEntryError,
  closeCreateEntryModal,
  submitCreateEntry,
  showDeleteEntryModal,
  deleteEntryTarget,
  deleteMultiNames,
  deleteEntryLoading,
  closeDeleteEntryModal,
  confirmDeleteEntry,
  showBackupNowWarningModal,
  backupNowLoading,
  stopOnBackup,
  hotBackupOnly = false,
  nativeBackup = false,
  closeBackupWarningModal,
  executeBackupNow,
}: ServerSettingsActionModalsProps) {
  useBodyScrollLock(showCreateEntryModal || showDeleteEntryModal);
  const [backupName, setBackupName] = useState('');
  useEffect(() => { if (showBackupNowWarningModal) setBackupName(''); }, [showBackupNowWarningModal]);
  const cleanName = backupName.trim().normalize('NFC').replace(/\.tar\.gz$/i, '');
  const nameValid = !cleanName || (/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,63}$/u.test(cleanName) && new TextEncoder().encode(cleanName).length <= 128);
  const handleCreateClose = () => {
    if (createEntryLoading) return;
    closeCreateEntryModal();
    clearCreateEntryError();
  };

  const handleDeleteClose = () => {
    if (deleteEntryLoading) return;
    closeDeleteEntryModal();
  };

  return (
    <>
      {showCreateEntryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
          <div
            className={`${modalBg} border ${borderColor} rounded-lg shadow-xl max-w-md w-full p-6`}
          >
            <div className="flex items-center justify-between gap-3 mb-5">
              <h3 className={`text-lg font-semibold ${textPrimary}`}>
                {createEntryType === 'folder' ? 'Create folder' : 'Create file'}
              </h3>
              <AppButton
                type="button"
                onClick={handleCreateClose}
                className={`p-2 rounded ${hoverBg} transition-colors ${textSecondary} hover:text-red-400`}
              >
                <X className="w-5 h-5" />
              </AppButton>
            </div>

            <div className="space-y-3">
              <label className={`block text-sm ${textSecondary}`}>
                {createEntryType === 'folder' ? 'Folder name' : 'File name'}
              </label>
              <AppInput
                type="text"
                value={createEntryName}
                onChange={(event) => {
                  setCreateEntryName(event.target.value);
                  clearCreateEntryError();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void submitCreateEntry();
                  }
                }}
                className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-lg ${textPrimary} focus:outline-none focus:border-[var(--color-cyan-400)]`}
                placeholder={createEntryType === 'folder' ? 'example-folder' : 'example.txt'}
                autoFocus
              />
              {createEntryError && <div className="text-sm text-red-400">{createEntryError}</div>}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <AppButton
                type="button"
                onClick={handleCreateClose}
                className="rounded bg-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-600 disabled:opacity-60"
                disabled={createEntryLoading}
              >
                Cancel
              </AppButton>
              <AppButton
                type="button"
                tone="primary"
                onClick={() => void submitCreateEntry()}
                disabled={createEntryLoading}
                className="rounded px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                {createEntryLoading ? 'Creating...' : 'Create'}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {showDeleteEntryModal && (deleteEntryTarget || (deleteMultiNames && deleteMultiNames.length > 0)) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
          <div
            className={`${modalBg} border ${borderColor} rounded-lg shadow-xl max-w-md w-full p-6`}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className={`text-lg font-semibold ${textPrimary}`}>
                {deleteMultiNames && deleteMultiNames.length > 0
                  ? `Delete ${deleteMultiNames.length} item${deleteMultiNames.length > 1 ? 's' : ''}`
                  : `Delete ${deleteEntryTarget?.type}`}
              </h3>
              <AppButton
                type="button"
                onClick={handleDeleteClose}
                className={`p-2 rounded ${hoverBg} transition-colors ${textSecondary} hover:text-red-400`}
              >
                <X className="w-5 h-5" />
              </AppButton>
            </div>

            <p className={`text-sm ${textSecondary}`}>
              {deleteMultiNames && deleteMultiNames.length > 0 ? (
                <>
                  Are you sure you want to permanently delete{' '}
                  <span className={`font-medium ${textPrimary}`}>
                    {deleteMultiNames.length} item{deleteMultiNames.length > 1 ? 's' : ''}
                  </span>
                  ? This cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to delete{' '}
                  <span className={`font-medium ${textPrimary}`}>{deleteEntryTarget?.name}</span>?
                </>
              )}
            </p>

            <div className="mt-6 flex items-center justify-end gap-2">
              <AppButton
                type="button"
                tone="neutral"
                onClick={handleDeleteClose}
                className="rounded px-4 py-2 text-sm disabled:opacity-60"
                disabled={deleteEntryLoading}
              >
                Cancel
              </AppButton>
              <AppButton
                type="button"
                tone="critical"
                onClick={() => void confirmDeleteEntry()}
                disabled={deleteEntryLoading}
                className="rounded px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                {deleteEntryLoading ? 'Deleting...' : 'Delete'}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      <AppModal open={showBackupNowWarningModal} onOpenChange={open => { if (!open && !backupNowLoading) closeBackupWarningModal(); }}>
        <AppModalContent aria-label="Create backup" className="max-w-md p-5" dismissible={!backupNowLoading}>
          <AppModalHeader><AppModalTitle>Create backup</AppModalTitle></AppModalHeader>
          <AppModalBody>
            <p className={`text-sm ${textSecondary} my-4`}>
              {nativeBackup ? 'The backup contains only serverfiles and does not change the server power state. If the game is running, files may come from different moments.' : hotBackupOnly ? 'The server will keep running while the backup is created.' : stopOnBackup ? 'The server will stop before the backup is created.' : 'The backup may run while the server is active.'}
            </p>
            {nativeBackup && <div className="space-y-2 my-4">
              <label htmlFor="native-backup-name" className={`text-sm ${textPrimary}`}>Backup name (optional)</label>
              <AppInput id="native-backup-name" value={backupName} onChange={event => setBackupName(event.target.value)} maxLength={71} placeholder="Before update" autoComplete="off" />
              <p className={`text-xs ${textSecondary}`}>Leave empty for an automatic name. Date and a unique identifier are always added.</p>
              {!nameValid && <p role="alert" className="text-xs text-red-500">Use up to 64 letters, numbers, spaces, dots, hyphens or underscores. Start with a letter or number.</p>}
            </div>}
            <div className="mt-5 flex justify-end gap-2">
              <AppButton tone="neutral" onClick={closeBackupWarningModal} disabled={backupNowLoading}>Cancel</AppButton>
              <AppButton tone="primary" disabled={backupNowLoading || (nativeBackup && !nameValid)} onClick={async () => { closeBackupWarningModal(); await executeBackupNow(nativeBackup ? cleanName : undefined); }}>Create backup</AppButton>
            </div>
          </AppModalBody>
        </AppModalContent>
      </AppModal>

    </>
  );
}



