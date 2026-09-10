import { useState } from 'react';
import { OvhcloudSettingsSection } from './OvhcloudSettingsSection';
import { ValheimFrameworkSection } from './ValheimFrameworkSection';
import { ModsSection } from './ModsSection';
import { GameWipeTab } from './GameWipeTab';
import { buildWipeModes } from './wipeModes';

export interface ValheimSectionsProps {
  serverId: number;
  serverStatus?: string | null;
  canReadMods: boolean;
  canWriteMods: boolean;
  canWriteFrameworks: boolean;
  canWipeSoft?: boolean;
  canWipeHard?: boolean;
  onReinstallStarted?: () => void;
  canManageEnv?: boolean;
  canEditContainerConfig?: boolean;
  canReadFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type ValheimSubTab = 'settings' | 'mods' | 'wipe';

export function ValheimSections({
  serverId,
  serverStatus,
  canReadMods,
  canWriteMods,
  canWriteFrameworks,
  canWipeSoft,
  canWipeHard,
  onReinstallStarted,
  canManageEnv,
  canEditContainerConfig,
  canReadFileManager,
  onOpenFileManagerPath,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: ValheimSectionsProps) {
  // Valheim has no config file: every setting is a launch parameter, so the settings screen
  // is guarded by the generic env permissions and the config-file links by fs.read.
  const canEditLaunchParams = Boolean(canManageEnv && canEditContainerConfig);
  const showSettingsTab = Boolean(canManageEnv) || Boolean(canReadFileManager);
  const showModsTab = canWriteFrameworks || canReadMods;

  const showWipeTab = buildWipeModes('valheim', {
    canSoft: Boolean(canWipeSoft),
    canHard: Boolean(canWipeHard),
  }).length > 0;

  const tabs: { id: ValheimSubTab; label: string }[] = [
    showSettingsTab && { id: 'settings', label: 'Server Settings' },
    showModsTab && { id: 'mods', label: 'Mods' },
    showWipeTab && { id: 'wipe', label: 'Wipe' },
  ].filter(Boolean) as { id: ValheimSubTab; label: string }[];

  const firstTab = tabs[0]?.id ?? 'settings';
  const [activeTab, setActiveTab] = useState<ValheimSubTab>(firstTab);
  const [visited, setVisited] = useState<Set<ValheimSubTab>>(() => new Set([firstTab]));
  const [bepinexInstalled, setBepinexInstalled] = useState(false);

  const switchTab = (id: ValheimSubTab) => {
    setActiveTab(id);
    setVisited((prev) => new Set([...prev, id]));
  };

  if (tabs.length === 0) return null;

  return (
    <div>
      {tabs.length > 1 && (
        <div className={`flex flex-wrap border-b ${borderColor} mb-3 gap-0`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-[var(--color-cyan-400)] text-white'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {visited.has('settings') && showSettingsTab && (
        <div className={`space-y-4 ${activeTab !== 'settings' ? 'hidden' : ''}`}>
          <OvhcloudSettingsSection
            serverId={serverId}
            serverStatus={serverStatus}
            canWriteFile={false}
            canWriteLaunch={canEditLaunchParams}
            canReadFileManager={canReadFileManager}
            onOpenFileManagerPath={onOpenFileManagerPath}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}

      {visited.has('mods') && showModsTab && (
        <div className={`space-y-4 ${activeTab !== 'mods' ? 'hidden' : ''}`}>
          {/* Reading the loader status needs no permission, so the badge shows for everyone
              who can see this tab; only the install control is gated. */}
          <ValheimFrameworkSection
            serverId={serverId}
            serverStatus={serverStatus}
            canWrite={canWriteFrameworks}
            onInstalledChange={setBepinexInstalled}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
          {canReadMods && (
            bepinexInstalled ? (
              <ModsSection
                serverId={serverId}
                serverStatus={serverStatus}
                kind="mods"
                apiKind="valheim"
                canRead={canReadMods}
                canWrite={canWriteMods}
                borderColor={borderColor}
                contentBg={contentBg}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
              />
            ) : (
              <div className={`${contentBg} border ${borderColor} rounded-lg p-4 text-sm ${textSecondary}`}>
                Install BepInEx to manage mods for this server.
              </div>
            )
          )}
        </div>
      )}

      {visited.has('wipe') && showWipeTab && (
        <div className={activeTab !== 'wipe' ? 'hidden' : ''}>
          <GameWipeTab
            family="valheim"
            serverId={serverId}
            serverStatus={serverStatus}
            canWipeSoft={Boolean(canWipeSoft)}
            canWipeHard={Boolean(canWipeHard)}
            onReinstallStarted={onReinstallStarted}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}
    </div>
  );
}
