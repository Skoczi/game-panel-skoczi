import React, { useEffect, useState } from 'react';
import { MAX_SERVER_LOG_LINES } from '../components/app/appRuntime';
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
  const [performanceLogs, setPerformanceLogs] = useState<any[] | null>(null);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('performance')) return;
    const append = (event: Event) => {
      const lines = (event as CustomEvent<number>).detail;
      setPerformanceLogs(previous => {
        const start = previous?.length ? previous[previous.length - 1].id : 0;
        const next = Array.from({ length: Math.min(lines, MAX_SERVER_LOG_LINES) }, (_, index) => ({
          id: start + index + 1, timestamp: new Date().toISOString(), type: 'info',
          message: `Performance log ${start + index + 1}: player event completed successfully`,
        }));
        return [...(previous || []), ...next].slice(-MAX_SERVER_LOG_LINES);
      });
    };
    window.addEventListener('gp-performance-logs', append);
    return () => window.removeEventListener('gp-performance-logs', append);
  }, []);
  const initialState = new URLSearchParams(location.search).get('snapshot');
  const [snapshot, setSnapshot] = useState(initialState || 'ready');
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
        status: new URLSearchParams(location.search).get('status') || 'running',
        connectionHost: '51.75.61.237',
        port: 27050,
        resources: { cpuCores: 0.12, cpuLimitCores: 2, cpuLimitPercent: 6, memoryBytes: 312 * 1024 ** 2, memoryLimitBytes: 1024 ** 3, memoryLimitPercent: 30.5, diskBytes: 1024 ** 3, nodeFreeBytes: 100 * 1024 ** 3 },
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
        resources: { cpuCores: i / 50, cpuLimitCores: 2, cpuLimitPercent: i, memoryBytes: 312 * 1024 ** 2, memoryLimitBytes: 1024 ** 3, memoryLimitPercent: 30.5 },
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
    serverSnapshotStatus: snapshot === 'missing' ? 'ready' : snapshot,
    onRetryServerSnapshot: () => setSnapshot('ready'),
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
      '7': performanceLogs ?? (new URLSearchParams(location.search).has('longLogs') ? Array.from({ length: 300 }, (_, index) => ({
        id: index + 1, timestamp: new Date().toISOString(), message: `Console history line ${index + 1}`, type: 'info',
      })) : [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          message: 'Server ready for players',
          type: 'info',
        },
      ]),
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
  if (snapshot !== 'ready') props.gameServers = [];
  return <AppShell {...props} />;
}
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <BrandingProvider>
      <Fixture />
    </BrandingProvider>
  </ThemeProvider>
);
