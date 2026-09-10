import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiClient, type RealtimeConnectionStatus } from '../utils/api';

export function RealtimeStatusBanner() {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(() =>
    apiClient.getConnectionStatus()
  );

  useEffect(() => apiClient.onConnectionStatusChange(setStatus), []);

  if (status !== 'reconnecting') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-amber-500/95 px-4 py-1.5 text-xs font-medium text-amber-950 shadow"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>Realtime connection lost — reconnecting… Displayed data may be out of date.</span>
    </div>
  );
}
