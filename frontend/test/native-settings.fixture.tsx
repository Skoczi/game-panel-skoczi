import React from 'react';
import { createRoot } from 'react-dom/client';
import { ServerSettingsModal } from '../components/ServerSettingsModal';
import { ThemeProvider } from '../contexts/ThemeContext';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
const native = !new URLSearchParams(location.search).has('external');
const templateDocument = { schemaVersion: 2, name: 'ReHLDS', mounts: [{ key: 'data', containerPath: '/data' }], lifecycle: { startup: ['/data/serverfiles/hlds_linux'] }, ...(new URLSearchParams(location.search).has('declared') ? { configFiles: [{ root: 'data', path: '/serverfiles/cstrike/server.cfg', label: 'Server configuration' }] } : {}) };
const metadata = JSON.stringify(native ? { template: { document: templateDocument } } : {});
createRoot(document.getElementById('root')!).render(<ThemeProvider>
  <ServerSettingsModal isOpen onClose={() => {}} serverName="Native test" serverGame="ReHLDS" serverProvider="external"
    serverProviderMetadataJson={metadata} serverStatus="stopped" serverId={7} currentUser={{ id: 1, username: 'admin', isRoot: true } as any} />
</ThemeProvider>);
