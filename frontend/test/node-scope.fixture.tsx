import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeScopeProvider } from '../contexts/NodeScopeContext';
import { Sidebar } from '../components/Sidebar';
import { FleetWorkspace } from '../components/FleetWorkspace';
import { HostStatusWorkspace } from '../components/hostStatus/HostStatusWorkspace';
import { ThemeProvider } from '../contexts/ThemeContext';
import { BrandingProvider } from '../contexts/BrandingContext';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
function Fixture() {
  const [tab, setTab] = useState('game-servers');
  const root = sessionStorage.getItem('test-player') !== '1';
  return (
    <ThemeProvider>
      <BrandingProvider>
        <NodeScopeProvider userId={1} enabled={root}>
          <div className="md:flex">
            <div className="shrink-0 w-52">
              <Sidebar
                staticLayout
                activeTab={tab}
                onTabChange={setTab}
                currentUser={{ id: 1, username: 'Admin', isRoot: root, isEnabled: true }}
              />
            </div>
            <main className="min-w-0 flex-1 p-6">
              {tab === 'game-servers' ? (
                <FleetWorkspace administrator={root} userId={1} />
              ) : tab === 'host-status' ? (
                <HostStatusWorkspace />
              ) : (
                <h1>Global settings</h1>
              )}
            </main>
          </div>
        </NodeScopeProvider>
      </BrandingProvider>
    </ThemeProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
