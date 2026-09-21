import { Server } from 'lucide-react';

export function SessionLoading() {
  return <div className="gp-session-loading" role="status" aria-label="Loading panel">
    <div className="gp-session-loader">
      <div className="gp-session-mark"><Server size={30} strokeWidth={1.5} /><span /></div>
      <div className="gp-session-wordmark">Game Panel</div>
      <div className="gp-session-track"><span /></div>
    </div>
  </div>;
}
