import { useEffect, useState } from 'react';
import { Download, Copy, RefreshCw, FolderOpen, Check, Loader2 } from 'lucide-react';
import { AppButton, AppToggle } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import './fastdownload.css';
export type FastDownloadStatus = {
  supported: boolean;
  available: boolean;
  enabled: boolean;
  compression: boolean;
  busy: boolean;
  url: string | null;
  directory: string | null;
  lastSync: string | null;
  error: string | null;
  published: number;
  folders: string[];
  canApplyConfig: boolean;
  configuration?: string;
};
export function FastDownloadCard({
  serverId,
  onOpenFiles,
  canConfigure = false,
}: {
  serverId: number;
  onOpenFiles?: (path: string) => void;
  canConfigure?: boolean;
}) {
  const [data, setData] = useState<FastDownloadStatus | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    const refresh = () =>
      apiClient
        .getFastDownload(serverId)
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e) => {
          if (active) setError(e.response?.data?.error || 'Could not load FastDownload');
        });
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [serverId]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setData(await apiClient.getFastDownload(serverId));
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'FastDownload request failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="gp-settings-card gp-fdl">
      <div className="gp-fdl-heading">
        <div className="gp-fdl-title">
          <span className="gp-fdl-icon">
            <Download size={21} />
          </span>
          <div>
            <h4>FastDownload</h4>
            <p>Game assets delivered from this node</p>
          </div>
        </div>
        {data?.supported && data.available && (
          <AppToggle
            checked={data.enabled}
            disabled={busy}
            onChange={(enabled) =>
              void action(() => apiClient.updateFastDownload(serverId, { enabled }))
            }
            label="Enable FastDownload"
          />
        )}
      </div>
      {!data && !error && (
        <p role="status">
          <Loader2 size={16} className="animate-spin" /> Loading FastDownload…
        </p>
      )}
      {data && !data.supported && (
        <p>
          This game template does not enable FastDownload. Configure it in the template’s
          FastDownload tab.
        </p>
      )}
      {data?.supported && !data.available && (
        <p>FastDownload hosting has not been configured on this node.</p>
      )}
      {data?.supported && data.available && (
        <>
          <div className="gp-fdl-address">
            <code>{data.url}</code>
            <AppButton
              tone="ghost"
              aria-label="Copy FastDownload URL"
              onClick={() =>
                void action(async () => {
                  await navigator.clipboard.writeText(data.url!);
                  setCopied(true);
                })
              }
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </AppButton>
          </div>
          <div className="gp-fdl-info">
            <div>
              <span>Automatic folders · from template</span>
              <div className="gp-fdl-folders">
                {data.folders.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </div>
            </div>
            <div>
              <span>Last synchronized</span>
              <strong>
                {data.busy
                  ? 'Synchronizing…'
                  : data.lastSync
                    ? new Date(data.lastSync).toLocaleString()
                    : 'Waiting for first sync'}
              </strong>
            </div>
          </div>
          {data.canApplyConfig && <p>{data.configuration || 'Not configured'}</p>}
          <AppToggle
            checked={data.compression}
            disabled={busy}
            onChange={(compression) =>
              void action(() => apiClient.updateFastDownload(serverId, { compression }))
            }
            label="Publish .bz2 only (Source games)"
          />
          <p>
            {data.compression ? (
              <>
                Only .bz2 files are generated in <code>/data{data.directory}</code>. Deleted source
                files are removed from FastDownload; standalone uploads stay. Automatic sync runs
                every minute.
              </>
            ) : (
              <>
                Files are served directly from <code>/data{data.directory}</code>, limited to the
                template’s folders. No copies or links are created; source changes apply
                immediately.
              </>
            )}
          </p>
          <div className="gp-fdl-actions">
            <AppButton
              tone="primary"
              disabled={busy || data.busy || !data.enabled}
              onClick={() => void action(() => apiClient.syncFastDownload(serverId))}
            >
              <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Synchronize now
            </AppButton>
            {onOpenFiles && (
              <AppButton
                tone="neutral"
                disabled={!data.lastSync}
                onClick={() => onOpenFiles(data.directory!)}
              >
                <FolderOpen size={16} />{' '}
                {data.compression ? 'Browse FastDownload' : 'Browse game files'}
              </AppButton>
            )}
            {canConfigure && data.canApplyConfig && (
              <AppButton
                tone="neutral"
                disabled={busy || !data.enabled}
                onClick={() =>
                  void action(async () => {
                    const r = await apiClient.configureFastDownload(serverId);
                    setMessage(r.message);
                  })
                }
              >
                Set URL in server.cfg
              </AppButton>
            )}
          </div>
        </>
      )}
      {(error || data?.error) && (
        <p role="alert" className="gp-fdl-error">
          {error || data?.error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
