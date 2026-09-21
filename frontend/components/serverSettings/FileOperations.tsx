import { useEffect, useState } from 'react';
import { apiClient, type FileTransferJob } from '../../utils/api';
import { OperationList } from './OperationList';

export function FileOperations({ serverId }: { serverId: number }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<FileTransferJob[]>([]);
  const [checked, setChecked] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await apiClient.listFileTransfers(serverId);
        if (active) { setJobs(result); setChecked(new Date().toLocaleString()); setError(false); }
      } catch { if (active) setError(true); }
      finally { polling = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [serverId, open]);
  return <details className="border-t border-slate-500/20 px-3 py-2 text-sm" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">File operation history</summary>
    {open && <div className="max-h-64 space-y-3 overflow-auto py-3">
      <p role="status">{error ? 'Status unavailable. Displayed results may be out of date. Check the existing operation before retrying.' : checked ? `Checked ${checked}` : 'Loading saved operations…'}</p>
      <OperationList label="File operations" operations={jobs.map(job => ({
        id: `file-${job.id}`, name: job.kind,
        status: job.status === 'pending' ? 'accepted' : job.status,
        startedAt: job.createdAt, completedAt: job.completedAt || undefined,
        detail: `${job.completedFiles} files · ${job.transferredBytes} bytes · ${job.basePath}`,
        error: job.errorMessage || undefined,
      }))} />
    </div>}
  </details>;
}
