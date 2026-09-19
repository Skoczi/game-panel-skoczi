import { useEffect, useState } from 'react';
import {
  AppModal,
  AppModalContent,
  AppModalHeader,
  AppModalTitle,
  AppModalDescription,
  AppModalBody,
} from '../src/ui/components';
import { fleetContext, fleetSocketUrl } from '../utils/fleetRuntime';
import { RealtimeGateway } from '../utils/api/realtimeGateway';
import { getStoredToken } from '../utils/api/runtime';
import './fleet-detail-modals.css';
type Action = {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  actorUsername?: string;
};
export function FleetHistoryModal({
  server,
  onClose,
}: {
  server: { id: string; name: string };
  onClose: () => void;
}) {
  const [actions, setActions] = useState<Action[]>([]);
  const [status, setStatus] = useState('Loading actions history…');
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let gateway: RealtimeGateway | undefined;
    setActions([]);
    setStatus('Loading actions history…');
    setError(false);
    void fleetContext(server.id)
      .then((context) => {
        if (cancelled) return;
        gateway = new RealtimeGateway(getStoredToken, fleetSocketUrl(context));
        gateway.onStatusChange((state) => {
          if (!cancelled && state === 'closed') {
            setActions([]);
            setStatus('History disconnected. Retry to reconnect.');
            setError(true);
          }
        });
        gateway.subscribeActions(context.runtimeId, 200);
        return gateway.connect((message) => {
          if (cancelled) return;
          if (message.type === 'error' || message.type === 'auth:error') {
            gateway?.close();
            setActions([]);
            setStatus('History unavailable. Check server access or retry.');
            setError(true);
            return;
          }
          if (Number(message.serverId) !== context.runtimeId) return;
          if (!['actions:history', 'actions:new'].includes(message.type)) return;
          const raw = message.type === 'actions:history' ? message.actions : [message.action];
          if (!Array.isArray(raw)) return;
          const next = raw.filter(
            (entry): entry is Action =>
              !!entry &&
              typeof entry.message === 'string' &&
              Number.isFinite(Date.parse(entry.timestamp))
          );
          setActions((previous) =>
            [
              ...new Map(
                (message.type === 'actions:history' ? next : [...previous, ...next]).map((a) => [
                  a.id ?? `${a.timestamp}:${a.message}`,
                  a,
                ])
              ).values(),
            ]
              .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
              .slice(0, 200)
          );
          setStatus('');
          setError(false);
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus(e.message || 'History unavailable');
          setError(true);
        }
      });
    return () => {
      cancelled = true;
      gateway?.close();
    };
  }, [server.id, retry]);
  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AppModalContent className="gp-fleet fleet-detail-modal">
        <AppModalHeader>
          <AppModalTitle>Actions history</AppModalTitle>
          <AppModalDescription>{server.name}</AppModalDescription>
        </AppModalHeader>
        <AppModalBody>
          {status ? (
            <div role={error ? 'alert' : 'status'}>
              <p>{status}</p>
              {error && (
                <button className="gp-fleet-button" onClick={() => setRetry((v) => v + 1)}>
                  Retry
                </button>
              )}
            </div>
          ) : actions.length === 0 ? (
            <p className="fleet-detail-empty">No actions history available yet for this server.</p>
          ) : (
            actions.map((action, i) => (
              <article
                className="fleet-action-entry"
                data-level={action.level}
                key={`${action.id}:${i}`}
              >
                <header>
                  <b>{action.level}</b>
                  <time>{new Date(action.timestamp).toLocaleString()}</time>
                </header>
                <p>
                  {action.actorUsername ? `[${action.actorUsername}] ` : ''}
                  {action.message}
                </p>
              </article>
            ))
          )}
        </AppModalBody>
      </AppModalContent>
    </AppModal>
  );
}
