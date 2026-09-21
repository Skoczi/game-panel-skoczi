import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { recordFleetDeletion } from '../../utils/deletedFleetServers';
import { ACTIVE_SERVER, openFleet } from '../../utils/nodeContext';
import { ConfirmationModal } from '../ConfirmationModal';

export function DeleteServerSection({ serverId, serverName }: { serverId: number; serverName: string }) {
  const [open, setOpen] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const remove = async () => {
    try {
      const result = await apiClient.deleteServer(serverId);
      if (result.success !== true) throw new Error('Deletion was not confirmed');
      if (ACTIVE_SERVER?.runtimeId === serverId) recordFleetDeletion(ACTIVE_SERVER.id);
      openFleet();
    } catch (error: any) {
      // A lost reply can follow a completed deletion. Require checking the fleet,
      // rather than sending another destructive request with a fresh key.
      if (!error?.response || error.response.status >= 500) {
        setUnknown(true);
        setOpen(false);
      }
      throw error;
    }
  };
  return <section aria-label="Delete server" className="rounded-lg border border-red-500/30 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h3 className="gp-section-title">Delete server</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Permanently remove this server, its files and local backups.</p>
      </div>
      <AppButton tone="critical" disabled={unknown} onClick={() => setOpen(true)}><Trash2 size={16} />Delete server</AppButton>
    </div>
    {unknown && <div className="mt-3 space-y-2">
      <p role="alert" className="text-sm text-red-500">Deletion could not be confirmed. Check the server list before trying again.</p>
      <AppButton onClick={openFleet}>Back to servers</AppButton>
    </div>}
    <ConfirmationModal isOpen={open} onClose={() => setOpen(false)} onConfirm={remove}
      title="Delete server?" icon="danger" confirmText="Delete server" requiredText={serverName}
      message={`Delete “${serverName}” and its files and local backups? This cannot be undone.`} />
  </section>;
}
