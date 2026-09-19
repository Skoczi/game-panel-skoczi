import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../components/app/AppShell';
import { ThemeProvider } from '../contexts/ThemeContext';
import { BrandingProvider } from '../contexts/BrandingContext';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
const noop = () => {};
const admin = !location.search.includes('restricted');
const metadata = JSON.stringify({
  template: {
    document: {
      schemaVersion: 2,
      name: 'Counter-Strike 1.6',
      mounts: [{ key: 'data', containerPath: '/data' }],
      lifecycle: { startup: ['/data/serverfiles/hlds_linux'] },
      configFiles: [
        { root: 'data', path: '/serverfiles/cstrike/server.cfg', label: 'Server configuration' },
      ],
    },
  },
});
function Fixture() {
  const [activeTab, setActiveTab] = useState('game-servers');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const props: any = {
    activeTab,
    setActiveTab,
    mobileMenuOpen,
    setMobileMenuOpen,
    currentUser: { id: 1, username: 'tester', isRoot: admin },
    currentUserId: 1,
    pageShellClassName: 'p-4',
    gameServers: [
      {
        id: '7',
        name: 'CS16 Test',
        game: 'Counter-Strike 1.6',
        provider: 'external',
        providerMetadataJson: metadata,
        status: 'running',
        connectionHost: '51.75.61.237',
        port: 27050,
        cpuUsage: 1.2,
        memoryUsage: 8.4,
        diskUsage: 4,
        networkIn: 1200,
        networkOut: 500,
        portBindings: { tcp: [], udp: [{ host: 27050, container: 27015, label: 'Game / Query' }] },
      },
    ],
    serverMetricsHistoryById: {
      '7': Array.from({ length: 12 }, (_, i) => ({
        timestamp: Date.now() - (12 - i) * 1000,
        cpuUsage: i / 5,
        memoryUsage: 8,
        networkIn: i * 100,
        networkOut: i * 50,
      })),
    },
    serverHistoryById: {
      '7': [
        { id: 1, timestamp: new Date().toISOString(), message: 'Server started', level: 'success' },
      ],
    },
    gameNamesByKey: {},
    serverPermissionsById: { '7': admin ? ['*'] : [] },
    handleServerAction: async (id: string, name: string, action: string) => {
      (window as any).actions = [...((window as any).actions || []), { id, name, action }];
    },
    onLoadServerMetricsHistory: noop,
    handleDeleteServer: noop,
    handleRenameServer: noop,
    handleRefreshServerSnapshot: noop,
    handleStartAll: noop,
    handleStopAll: noop,
    canInstallServers: false,
    installModalOpen: false,
    setInstallModalOpen: noop,
    handleInstallGame: noop,
    installing: false,
    installError: null,
    installProgressPercent: null,
    installStatus: null,
    installServerId: null,
    installInteraction: null,
    setInstallInteraction: noop,
    installPlan: [],
    installPermissionsSyncing: false,
    usedInstallPorts: { tcp: new Set(), udp: new Set() },
    handleClearInstallError: noop,
    openInstallLogs: noop,
    serverLogs: {
      '7': [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          message: 'Server ready for players',
          type: 'info',
        },
      ],
    },
    onAppendServerLog: noop,
    cliMessages: [],
    handleClearServerLogs: noop,
    handleClearCLI: noop,
    activeConsoleTab: 'cli-console',
    setActiveConsoleTab: noop,
    handleCloseConsoleTab: noop,
    openConsoleTabs: [],
    activeLogPromptToasts: [],
    removeLogPromptToast: noop,
    logoutConfirmOpen: false,
    setLogoutConfirmOpen: noop,
    handleLogout: noop,
    changePasswordOpen: false,
    setChangePasswordOpen: noop,
    handleRequestLogout: noop,
    handleOpenChangePassword: noop,
  };
  return <AppShell {...props} />;
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <BrandingProvider>
      <Fixture />
    </BrandingProvider>
  </ThemeProvider>
);
