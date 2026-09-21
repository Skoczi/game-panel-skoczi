import { ArrowLeft, RefreshCw, Server, Unplug, Waypoints } from 'lucide-react';
import './server-page.css';

export function ServerPageState({
  state,
  onBack,
  onRetry,
}: {
  state: 'loading' | 'error' | 'missing' | 'wrong-node';
  onBack: () => void;
  onRetry: () => void;
}) {
  const loading = state === 'loading';
  const Icon = state === 'wrong-node' ? Waypoints : state === 'error' ? Unplug : Server;
  const title = loading
    ? 'Loading server…'
    : state === 'error'
      ? 'Unable to connect'
      : state === 'wrong-node'
        ? 'Different execution node'
        : 'Server unavailable';
  const description = loading
    ? 'Connecting to the node.'
    : state === 'error'
      ? 'The node has not returned the server list. Try again in a moment.'
      : state === 'wrong-node'
        ? 'This link belongs to another node. Open the server from your server list.'
        : 'This server is no longer in your available servers. It may have been removed or your access may have changed.';
  return (
    <section className="gp-server-page gp-server-state" aria-busy={loading}>
      <button className="gp-server-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to servers
      </button>
      <div className="gp-server-state-message" role="status" aria-live="polite">
        <div className={`gp-server-state-icon${loading ? ' is-loading' : ''}`}>
          <Icon size={26} />
        </div>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {!loading && state !== 'wrong-node' && (
          <button className="gp-server-back gp-server-state-retry" onClick={onRetry}>
            <RefreshCw size={16} />
            Try again
          </button>
        )}
      </div>
      {loading && (
        <div className="gp-server-skeleton" aria-hidden="true">
          <div className="gp-server-skeleton-tabs">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="gp-server-skeleton-grid">
            <div className="gp-server-skeleton-console">
              <span />
              <span />
              <span />
            </div>
            <div className="gp-server-skeleton-stats">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
