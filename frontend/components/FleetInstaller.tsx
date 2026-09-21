import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { NativeTemplatePicker } from './NativeTemplatePicker';
import type { TemplateVersion } from '../utils/gameTemplates';

const TemplateInstall = lazy(() => import('./GameTemplates').then(module => ({ default: module.TemplateInstall })));

export function FleetInstaller({ initialNodeId, onClose }: { initialNodeId?: string; onClose: () => void }) {
  const [template, setTemplate] = useState<TemplateVersion | null>(null);
  const [search, setSearch] = useState('');
  // Capture the scope when the wizard opens; changing a sidebar filter must not retarget a form.
  const [nodeId] = useState(initialNodeId);
  return <section className="gp-fleet gp-fleet-node-workspace" aria-label="Add game server">
    {template ? <Suspense fallback={<p role="status">Loading installer…</p>}>
      <TemplateInstall row={template} initialNodeId={nodeId} resumePreviousInstallation={false} onClose={() => setTemplate(null)} />
    </Suspense> : <>
      <header className="gp-fleet-heading">
        <h1>Add Game Server</h1>
        <button className="gp-fleet-button" onClick={onClose}><ArrowLeft size={16} />Back to servers</button>
      </header>
      <div className="gp-fleet-toolbar">
        <label className="gp-fleet-search">
          <Search size={18} />
          <input aria-label="Search game templates" placeholder="Search games…" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
      <NativeTemplatePicker search={search} canInstall onSelect={setTemplate} />
    </>}
  </section>;
}
