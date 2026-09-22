import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeGameConfig } from '../components/serverSettings/NativeGameConfig';
import { TemplateGameConfigEditor } from '../components/TemplateGameConfigEditor';
import { ThemeProvider } from '../contexts/ThemeContext';
import { cs16GameConfig } from '../../backend/src/templates/gameConfig';
import type { GameTemplate } from '../utils/gameTemplates';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
const query = new URLSearchParams(location.search);
const definition = cs16GameConfig();
const original = { schemaVersion: 2, name: 'Counter-Strike 1.6 ReHLDS', configFiles: [{ root: 'data', path: definition.path, label: 'Server settings' }, { root: 'data', path: '/serverfiles/cstrike/mapcycle.txt', label: 'Map rotation' }], gameConfig: definition, variables: [], ports: [], mounts: [{ key: 'data', containerPath: '/data' }], lifecycle: { startup: ['/bin/bash', '-c', 'exec ./hlds_linux "$@"', 'hlds', '-game', 'cstrike'] } } as unknown as GameTemplate;
function Fixture() {
  const [draft, setDraft] = useState(original);
  const [opened, setOpened] = useState('');
  const [dirty, setDirty] = useState(false);
  return <ThemeProvider><main style={{ padding: 24, maxWidth: 1540, margin: 'auto' }}>
    {query.has('template') ? <TemplateGameConfigEditor draft={draft} change={patch => setDraft(d => ({ ...d, ...patch }))} /> : <NativeGameConfig serverId={8} metadata={JSON.stringify({ template: { document: original } })} canWrite={!query.has('readonly')} canRead={!query.has('noaccess')} onOpen={(path, root) => setOpened(`${root}:${path}`)} onDirtyChange={setDirty} />}
    <output hidden aria-label="Opened file">{opened}</output><output hidden aria-label="Unsaved configuration">{String(dirty)}</output>
    {query.has('template') && <output hidden aria-label="Template form path">{draft.gameConfig?.path}</output>}
  </main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
