import { NodeScopeProvider, useNodeScope } from '../../contexts/NodeScopeContext';
import { ErrorBoundary } from '../ErrorBoundary';
import { lazy, Suspense, useRef } from 'react';
import { Menu } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useFocusTrap } from '../../src/ui/utils/useFocusTrap';
import { Sidebar } from '../Sidebar';
import { UserAdministration } from '../UserAdministration';
import { ServerConsoleTabs } from '../ServerConsoleTabs';
import { apiClient } from '../../utils/api';
import { LogPromptToasts } from '../LogPromptToasts';
import { ConfirmationModal } from '../ConfirmationModal';
import { ChangePasswordModal } from '../ChangePasswordModal';
import { AppPageLayout } from '../../src/ui/layout';

const HostStatus = lazy(() =>
  import('../hostStatus/HostStatusWorkspace').then((m) => ({ default: m.HostStatusWorkspace }))
);
const GlobalSettings = lazy(() =>
  import('../GlobalSettings').then((m) => ({ default: m.GlobalSettings }))
);
const Nodes = lazy(() => import('../Nodes').then((m) => ({ default: m.Nodes })));
const GameTemplates = lazy(() =>
  import('../GameTemplates').then((m) => ({ default: m.GameTemplates }))
);
import type { CLIMessage } from '../../types/cli';
import type { GameServer, InstallInteraction, InstallStep } from '../../types/gameServer';
import type { AuthUser } from '../../utils/permissions';
import type { InstallGameHandlerPayload } from './appActionHandlers';
import type {
  LogEntry,
  ServerHistoryById,
  ServerLogs,
  ServerMetricHistoryPoint,
} from '../../utils/serverRuntime';
import { nextId } from '../../utils/uid';
import type { ActiveLogPromptToast, ConsoleTerminalTarget } from './appRuntime';
import { AppButton } from '../../src/ui/components';
import { supportsConsoleCommand } from '../../utils/providerCapabilities';
import { FleetWorkspace } from '../FleetWorkspace';
import { ACTIVE_NODE, ACTIVE_SERVER, ADMIN_RUNTIME, openFleet } from '../../utils/nodeContext';
import { ServerManagementPage } from '../ServerManagementPage';
import { ServerPageState } from '../serverSettings/ServerPageState';
import { useServerPageRoute } from '../serverSettings/useServerPageRoute';

interface AppShellProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  handleRequestLogout: () => void;
  handleOpenChangePassword: () => void;
  canManageUsers: boolean;
  currentUser: AuthUser | null;
  pageShellClassName: string;
  gameServers: GameServer[];
  serverSnapshotStatus?: 'loading' | 'ready' | 'error';
  onRetryServerSnapshot?: () => void;
  serverMetricsHistoryById: Record<string, ServerMetricHistoryPoint[]>;
  onLoadServerMetricsHistory: (serverId: string) => void;
  serverHistoryById: ServerHistoryById;
  gameNamesByKey: Record<string, string>;
  serverPermissionsById: Record<string, string[]>;
  handleDeleteServer: (id: string) => Promise<void>;
  handleServerAction: (
    serverId: string,
    serverName: string,
    action: string,
    propagateError?: boolean
  ) => Promise<void>;
  openConsoleTerminal: (serverId: number, serverName: string) => void;
  handleRenameServer: (id: string, newName: string) => Promise<void>;
  handleRefreshServerSnapshot: () => Promise<void>;
  handleStartAll: () => void;
  handleStopAll: () => void;
  canInstallServers: boolean;
  installModalOpen: boolean;
  setInstallModalOpen: (open: boolean) => void;
  handleInstallGame: (payload: InstallGameHandlerPayload) => Promise<void>;
  installing: boolean;
  installError: string | null;
  installProgressPercent: number | null;
  installStatus: string | null;
  installServerId: number | null;
  installInteraction: InstallInteraction | null;
  setInstallInteraction: (v: InstallInteraction | null) => void;
  installPlan: InstallStep[];
  installPermissionsSyncing: boolean;
  usedInstallPorts: { tcp: Set<number>; udp: Set<number> };
  handleClearInstallError: () => void;
  openInstallLogs: (serverId: number) => void;
  serverLogs: ServerLogs;
  onAppendServerLog: (serverId: string, log: LogEntry) => void;
  cliMessages: CLIMessage[];
  handleClearServerLogs: (serverId: string) => void;
  handleClearCLI: () => void;
  activeConsoleTab: string | null;
  setActiveConsoleTab: (tab: string | null) => void;
  handleCloseConsoleTab: (serverId: string) => void;
  openConsoleTabs: string[];
  consoleTerminalTarget: ConsoleTerminalTarget | null;
  setConsoleTerminalTarget: (target: ConsoleTerminalTarget | null) => void;
  activeLogPromptToasts: ActiveLogPromptToast[];
  removeLogPromptToast: (toastId: string) => void;
  logoutConfirmOpen: boolean;
  setLogoutConfirmOpen: (open: boolean) => void;
  handleLogout: () => void;
  changePasswordOpen: boolean;
  setChangePasswordOpen: (open: boolean) => void;
  currentUserId: number | null;
}

export function AppShell(props: AppShellProps) {
  return (
    <NodeScopeProvider
      key={props.currentUser?.id}
      userId={props.currentUser?.id || 0}
      enabled={Boolean(props.currentUser?.isRoot)}
    >
      <AppShellContent {...props} />
    </NodeScopeProvider>
  );
}

function AppShellContent({
  activeTab,
  setActiveTab,
  mobileMenuOpen,
  setMobileMenuOpen,
  handleRequestLogout,
  handleOpenChangePassword,
  canManageUsers,
  currentUser,
  pageShellClassName,
  gameServers,
  serverSnapshotStatus = 'ready',
  onRetryServerSnapshot,
  serverMetricsHistoryById,
  onLoadServerMetricsHistory,
  serverHistoryById,
  gameNamesByKey,
  serverPermissionsById,
  handleServerAction,
  handleRefreshServerSnapshot,
  serverLogs,
  onAppendServerLog,
  handleClearServerLogs,
  activeLogPromptToasts,
  removeLogPromptToast,
  logoutConfirmOpen,
  setLogoutConfirmOpen,
  handleLogout,
  changePasswordOpen,
  setChangePasswordOpen,
  currentUserId,
}: AppShellProps) {
  const { route, navigate, setDirty, allowLeave } = useServerPageRoute();
  const { selectScope } = useNodeScope();
  const changeNodeScope = async (id: string) => {
    if (!(await allowLeave())) return;
    selectScope(id);
    setMobileMenuOpen(false);
    if (activeTab === 'game-servers' && (ACTIVE_SERVER || ADMIN_RUNTIME)) openFleet();
  };
  const managedServer =
    route?.node === ACTIVE_NODE ? gameServers.find((server) => server.id === route.id) : undefined;
  const changeMainTab = async (tab: string) => {
    if (await allowLeave()) setActiveTab(tab);
  };
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const mobileNavRef = useRef<HTMLDivElement>(null);
  useFocusTrap(mobileMenuOpen, mobileNavRef, { onEscape: () => setMobileMenuOpen(false) });

  const canSendCommandByServer: Record<string, boolean> = {};
  for (const server of gameServers) {
    const perms = serverPermissionsById[server.id] ?? [];
    const permitted =
      Boolean(currentUser?.isRoot) || perms.includes('*') || perms.includes('server.command.send');
    canSendCommandByServer[server.id] =
      permitted && supportsConsoleCommand(server.providerMetadataJson);
  }

  const handleSendConsoleCommand = async (serverId: string, command: string) => {
    const result = await apiClient.sendConsoleCommand(Number(serverId), command);

    // Some consoles (e.g. Palworld's REST API) return read-command output only in
    // the HTTP response, never in the logs stream. Surface stdout/stderr in the
    // console so it isn't lost. Pretty-print JSON payloads when possible.
    const prettify = (raw: string) => {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    };
    const appendOutput = (message: string, type: LogEntry['type']) => {
      onAppendServerLog(serverId, {
        id: nextId(),
        timestamp: new Date().toISOString(),
        type,
        message,
      });
    };

    const stdout = (result?.stdout ?? '').trim();
    const stderr = (result?.stderr ?? '').trim();
    if (stdout) appendOutput(prettify(stdout), result?.ok ? 'info' : 'warning');
    if (stderr) appendOutput(stderr, 'error');
  };

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-transparent">
      <div className="hidden md:block">
        <Sidebar
          onNodeScopeChange={changeNodeScope}
          activeTab={activeTab}
          onTabChange={changeMainTab}
          onLogout={handleRequestLogout}
          onChangePassword={handleOpenChangePassword}
          canManageUsers={canManageUsers}
          currentUser={currentUser}
        />
      </div>

      <div
        className={`md:hidden fixed top-0 left-0 right-0 z-40 border-b ${mobileMenuOpen ? 'hidden' : ''} ${isDark ? 'border-gray-800 bg-[#111827]' : 'border-[#000b82] bg-[#000e9c]'}`}
      >
        <div className="flex items-center justify-between p-4">
          <AppButton
            onClick={() => setMobileMenuOpen(true)}
            tone="ghost"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={mobileMenuOpen}
            aria-controls="gp-mobile-nav"
            className={`h-10 w-10 rounded-lg border-none bg-transparent p-2 ${isDark ? 'hover:bg-gray-800' : 'hover:bg-white/15'}`}
          >
            <Menu className={`w-6 h-6 ${isDark ? 'text-white' : 'text-white'}`} />
          </AppButton>
          {/* Modified by Skoczi: independent fork identity on mobile. */}
          <span className="text-white text-center text-sm font-semibold">
            Game Panel
            <br />
            Skoczi Edition
          </span>
          <div className="w-10"></div>
        </div>
      </div>

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 bg-black/50 z-50 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            id="gp-mobile-nav"
            ref={mobileNavRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            className={`fixed top-0 left-0 bottom-0 w-[280px] z-50 md:hidden overflow-y-auto focus:outline-none ${isDark ? 'bg-[#111827]' : 'bg-white'}`}
          >
            <Sidebar
          onNodeScopeChange={changeNodeScope}
              activeTab={activeTab}
              onTabChange={(tab) => {
                changeMainTab(tab);
                setMobileMenuOpen(false);
              }}
              onLogout={handleRequestLogout}
              onChangePassword={handleOpenChangePassword}
              canManageUsers={canManageUsers}
              staticLayout
              currentUser={currentUser}
            />
          </div>
        </>
      )}

      <main className="flex-1 w-full overflow-x-hidden bg-transparent pt-16 md:pl-52 md:pt-0">
        <ErrorBoundary section key={activeTab}>
        {activeTab === 'host-status' && currentUser?.isRoot && (
          <AppPageLayout className={pageShellClassName}>
            <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
              <HostStatus />
            </Suspense>
          </AppPageLayout>
        )}

        {activeTab === 'game-servers' && currentUser && !route && (
          <AppPageLayout className={pageShellClassName}>
            <FleetWorkspace
              key={currentUser?.id}
              userId={currentUser.id}
              gameNames={gameNamesByKey}
              administrator={Boolean(currentUser?.isRoot)}
              onNodes={() => setActiveTab('nodes')}
            />
          </AppPageLayout>
        )}
        {activeTab === 'game-servers' && route && (
          <AppPageLayout className={pageShellClassName}>
            {managedServer ? (
                <ServerManagementPage
                  key={`${route.node}:${route.id}`}
                  server={managedServer}
                  currentUser={currentUser}
                  permissions={serverPermissionsById[managedServer.id] || []}
                  gameName={gameNamesByKey[managedServer.game] || managedServer.game}
                  nodeName={
                    ACTIVE_SERVER?.nodeName || (ACTIVE_NODE === 'local' ? 'Local' : 'Remote node')
                  }
                  tab={route.tab}
                  onTab={(tab) => navigate({ ...route, tab })}
                  onBack={async () => {
                    if (await allowLeave()) openFleet();
                  }}
                  onDirtyChange={setDirty}
                  onAction={(id, name, action) =>
                    handleServerAction(id, name, action, action !== 'debug')
                  }
                  onLoadMetrics={onLoadServerMetricsHistory}
                  metrics={serverMetricsHistoryById[managedServer.id] || []}
                  history={serverHistoryById[managedServer.id] || []}
                  consoleContent={
                    <ServerConsoleTabs
                      singleServer
                      servers={[managedServer]}
                      logs={serverLogs}
                      cliMessages={[]}
                      onClearLogs={handleClearServerLogs}
                      onClearCLI={() => {}}
                      activeTab={managedServer.id}
                      onSetActiveTab={() => {}}
                      onCloseTab={() => {}}
                      openTabs={[managedServer.id]}
                      canSendCommandByServer={canSendCommandByServer}
                      onSendCommand={handleSendConsoleCommand}
                    />
                  }
                />
              ) : (
                <ServerPageState
                  state={
                    route.node !== ACTIVE_NODE
                      ? 'wrong-node'
                      : serverSnapshotStatus === 'ready'
                        ? 'missing'
                        : serverSnapshotStatus
                  }
                  onBack={openFleet}
                  onRetry={onRetryServerSnapshot || handleRefreshServerSnapshot}
                />
              )}
          </AppPageLayout>
        )}

        {activeTab === 'game-templates' && currentUser?.isRoot && (
          <AppPageLayout className={pageShellClassName}>
            <Suspense fallback={<p>Loading templates…</p>}>
              <GameTemplates />
            </Suspense>
          </AppPageLayout>
        )}
        {activeTab === 'nodes' && currentUser?.isRoot && (
          <AppPageLayout className={pageShellClassName}>
            <Suspense fallback={<p>Loading nodes…</p>}>
              <Nodes />
            </Suspense>
          </AppPageLayout>
        )}
        {activeTab === 'settings' && currentUser?.isRoot && (
          <AppPageLayout className={pageShellClassName}>
            <Suspense fallback={<p>Loading settings…</p>}>
              <GlobalSettings />
            </Suspense>
          </AppPageLayout>
        )}

        {activeTab === 'admin-users' && (
          <AppPageLayout className={pageShellClassName}>
            <UserAdministration
              servers={gameServers}
              fleetAdministration={Boolean(currentUser?.isRoot)}
              currentUserId={currentUserId}
              canManageUsers={canManageUsers}
            />
          </AppPageLayout>
        )}
        </ErrorBoundary>
      </main>

      <LogPromptToasts toasts={activeLogPromptToasts} onClose={removeLogPromptToast} />

      <ConfirmationModal
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={handleLogout}
        title="Log out?"
        message="Are you sure you want to log out of the panel?"
        confirmText="Log out"
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        showCloseButton={false}
        icon="danger"
      />

      <ChangePasswordModal
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
}
