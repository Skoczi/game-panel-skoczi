import { useState } from 'react';
import { OvhcloudSettingsSection } from './OvhcloudSettingsSection';
import { RustFrameworkSection } from './RustFrameworkSection';
import { ModsSection } from './ModsSection';
import { GameWipeTab } from './GameWipeTab';
import { buildWipeModes } from './wipeModes';

export interface RustSectionsProps {
  serverId: number;
  serverStatus?: string | null;
  canReadSettings: boolean;
  canWriteSettings: boolean;
  canReadMods: boolean;
  canWriteMods: boolean;
  canWriteFrameworks: boolean;
  canWipeSoft?: boolean;
  canWipeHard?: boolean;
  onReinstallStarted?: () => void;
  canManageEnv?: boolean;
  canEditContainerConfig?: boolean;
  containerConfigSaveCount?: number;
  canReadFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type RustSubTab = 'settings' | 'oxide' | 'wipe';

export function RustSections({
  serverId,
  serverStatus,
  canReadSettings,
  canWriteSettings,
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
}: RustSectionsProps) {
  const canEditLaunchParams = Boolean(canManageEnv && canEditContainerConfig);
  const showSettingsTab = canReadSettings || Boolean(canManageEnv);
  const showOxideTab = canWriteFrameworks || canReadMods;

  const showWipeTab = buildWipeModes('rust', {
    canSoft: Boolean(canWipeSoft),
    canHard: Boolean(canWipeHard),
  }).length > 0;

  const tabs: { id: RustSubTab; label: string }[] = [
    showSettingsTab && { id: 'settings', label: 'Server Settings' },
    showOxideTab && { id: 'oxide', label: 'Mods' },
    showWipeTab && { id: 'wipe', label: 'Wipe' },
  ].filter(Boolean) as { id: RustSubTab; label: string }[];

  const firstTab = tabs[0]?.id ?? 'settings';
  const [activeTab, setActiveTab] = useState<RustSubTab>(firstTab);
  const [visited, setVisited] = useState<Set<RustSubTab>>(() => new Set([firstTab]));
  const [oxideInstalled, setOxideInstalled] = useState(false);

  const switchTab = (id: RustSubTab) => {
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
            canWriteFile={canWriteSettings}
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

      {visited.has('oxide') && showOxideTab && (
        <div className={`space-y-4 ${activeTab !== 'oxide' ? 'hidden' : ''}`}>
          {canWriteFrameworks && (
            <RustFrameworkSection
              serverId={serverId}
              serverStatus={serverStatus}
              canWrite={canWriteFrameworks}
              onInstalledChange={setOxideInstalled}
              borderColor={borderColor}
              contentBg={contentBg}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          )}
          {canReadMods && (
            oxideInstalled ? (
              <ModsSection
                serverId={serverId}
                serverStatus={serverStatus}
                kind="mods"
                apiKind="rust"
                canRead={canReadMods}
                canWrite={canWriteMods}
                borderColor={borderColor}
                contentBg={contentBg}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
              />
            ) : (
              <div className={`${contentBg} border ${borderColor} rounded-lg p-4 text-sm ${textSecondary}`}>
                Install Oxide to manage plugins for this server.
              </div>
            )
          )}
        </div>
      )}

      {visited.has('wipe') && showWipeTab && (
        <div className={activeTab !== 'wipe' ? 'hidden' : ''}>
          <GameWipeTab
            family="rust"
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
