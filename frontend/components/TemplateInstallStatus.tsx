import { ArrowLeft, ArrowRight, Check, AlertCircle, Layers, Loader2, Server, Terminal } from 'lucide-react';

type Props = {
  name: string; template: string; version: number; node: string; serverId: number;
  connection: string; progress: number; status: string; warning?: string; error?: string;
  onCatalog: () => void; onProgress: () => void; onConsole: () => void; onServers: () => void; onAnother: () => void;
};
export function TemplateInstallStatus(props: Props) {
  const complete = props.status === 'completed';
  const failed = props.status === 'failed';
  const percent = Math.max(0, Math.min(100, Number.isFinite(props.progress) ? props.progress : 0));
  const label = props.warning ? 'Reconnecting' : complete ? 'Ready' : failed ? 'Needs attention' : 'Installing';
  const Icon = props.warning || failed ? AlertCircle : complete ? Check : Loader2;
  return <section className="gp-install-status" data-state={failed ? 'failed' : complete ? 'completed' : 'installing'} aria-label="Server installation">
    <div className="gp-install-status__top">
      <button type="button" className="gp-install-status__back" onClick={props.onCatalog}><ArrowLeft size={16} /> Catalog</button>
      <span className="gp-install-status__badge" role="status"><Icon size={14} className={!complete && !failed && !props.warning ? 'gp-install-status__spinner' : ''} />{label}</span>
    </div>
    <div className="gp-install-status__heading">
      <span className="gp-install-status__icon"><Server size={26} /></span>
      <div><p className="gp-install-status__eyebrow">{complete ? 'SERVER READY' : failed ? 'INSTALLATION FAILED' : 'SERVER SETUP'}</p>
        <h2>{props.name}</h2><p className="gp-install-status__template">{props.template} <span>· v{props.version}</span></p>
      </div>
    </div>
    <dl className="gp-install-status__details">
      <div><dt>Node</dt><dd>{props.node}</dd></div>
      <div><dt>Connection</dt><dd className="gp-install-status__address">{props.connection || 'Assigning address…'}</dd></div>
      <div><dt>Server</dt><dd>#{props.serverId}</dd></div>
    </dl>
    <div className="gp-install-status__progress">
      <div><span>{complete ? 'Installation complete' : failed ? 'Check the console for details' : 'Preparing your game server'}</span><strong>{percent}%</strong></div>
      <div className="gp-install-status__track" role="progressbar" aria-label="Installation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
    </div>
    {(props.warning || props.error) && <p className="gp-install-status__warning" role="alert">{props.warning || props.error}</p>}
    <div className="gp-install-status__actions">
      <button type="button" className="gp-install-status__primary" onClick={complete || failed ? props.onConsole : props.onProgress}>{complete || failed ? <Terminal size={18} /> : <Layers size={18} />}{complete || failed ? 'Open console' : 'View progress'}</button>
      {!complete && !failed && <button type="button" onClick={props.onConsole}><Terminal size={18} />Open console</button>}
      <button type="button" onClick={props.onServers}>Game servers<ArrowRight size={16} /></button>
      {(complete || failed) && <button type="button" className="gp-install-status__another" onClick={props.onAnother}>Create another server</button>}
    </div>
  </section>;
}
