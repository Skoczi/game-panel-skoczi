import React from 'react';
import { createRoot } from 'react-dom/client';
import { FleetWorkspace } from '../components/FleetWorkspace';
import { Sidebar } from '../components/Sidebar';
import { ThemeProvider } from '../contexts/ThemeContext';
import { BrandingProvider } from '../contexts/BrandingContext';
import { ACTIVE_SERVER, openFleet } from '../utils/nodeContext';
import { apiClient } from '../utils/api';
import { useAuthSession } from '../components/app/useAuthSession';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
const admin = sessionStorage.getItem('test-admin') === '1';
function SessionProbe() {
  const session = useAuthSession();
  return (
    <output data-testid="session-permissions">
      {session.authReady ? JSON.stringify(session.serverPermissionsById) : 'loading'}
    </output>
  );
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <BrandingProvider>
      <div className="hidden md:block">
        <Sidebar
          activeTab="game-servers"
          onTabChange={() => {}}
          currentUser={{ id: 2, username: 'Player', isRoot: admin, isEnabled: true }}
          canManageUsers={admin}
        />
      </div>
      <main className="min-h-screen bg-slate-50 p-6 md:ml-52 dark:bg-slate-950">
        {ACTIVE_SERVER ? (
          <>
            {sessionStorage.getItem('test-session') === '1' && <SessionProbe />}
            <h1>{ACTIVE_SERVER.name}</h1>
            <p>{ACTIVE_SERVER.location}</p>
            <button
              onClick={() => void apiClient.getServer(ACTIVE_SERVER.runtimeId).catch(() => {})}
            >
              Test server route
            </button>
            <button onClick={openFleet}>All servers</button>
          </>
        ) : (
          <FleetWorkspace
            userId={Number(sessionStorage.getItem('test-user') || 2)}
            administrator={admin}
            onNodes={() => {}}
          />
        )}
      </main>
    </BrandingProvider>
  </ThemeProvider>
);
