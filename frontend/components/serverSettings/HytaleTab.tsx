import { useState } from 'react';
import { OvhcloudSettingsSection } from './OvhcloudSettingsSection';
import { ModsSection } from './ModsSection';
import { GameWipeTab } from './GameWipeTab';
import { buildWipeModes } from './wipeModes';

export interface HytaleSectionsProps {
  serverId: number;
  serverStatus?: string | null;
  canReadSettings: boolean;
  canWriteSettings: boolean;
  canReadMods: boolean;
  canWriteMods: boolean;
  canWipeSoft?: boolean;
  canWipeHard?: boolean;
  onReinstallStarted?: () => void;
  canReadFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type HytaleSubTab = 'settings' | 'mods' | 'wipe';

export function HytaleSections({
  serverId,
  serverStatus,
  canReadSettings,
  canWriteSettings,
  canReadMods,
  canWriteMods,
  canWipeSoft,
  canWipeHard,
  onReinstallStarted,
  canReadFileManager,
  onOpenFileManagerPath,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: HytaleSectionsProps) {
  const showWipeTab = buildWipeModes('hytale', {
    canSoft: Boolean(canWipeSoft),
    canHard: Boolean(canWipeHard),
  }).length > 0;

  const tabs: { id: HytaleSubTab; label: string }[] = [
    canReadSettings && { id: 'settings', label: 'Server Settings' },
    canReadMods     && { id: 'mods',     label: 'Mods' },
    showWipeTab     && { id: 'wipe',     label: 'Wipe' },
  ].filter(Boolean) as { id: HytaleSubTab; label: string }[];

  const firstTab = tabs[0]?.id ?? 'settings';
  const [activeTab, setActiveTab] = useState<HytaleSubTab>(firstTab);
  const [visited, setVisited] = useState<Set<HytaleSubTab>>(() => new Set([firstTab]));

  const switchTab = (id: HytaleSubTab) => {
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

      {visited.has('settings') && canReadSettings && (
        <div className={activeTab !== 'settings' ? 'hidden' : ''}>
          <OvhcloudSettingsSection
            serverId={serverId}
            serverStatus={serverStatus}
            canWriteFile={canWriteSettings}
            canReadFileManager={canReadFileManager}
            onOpenFileManagerPath={onOpenFileManagerPath}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}
      {visited.has('mods') && canReadMods && (
        <div className={activeTab !== 'mods' ? 'hidden' : ''}>
          <ModsSection
            serverId={serverId}
            serverStatus={serverStatus}
            kind="mods"
            apiKind="hytale"
            canRead={canReadMods}
            canWrite={canWriteMods}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}
      {visited.has('wipe') && showWipeTab && (
        <div className={activeTab !== 'wipe' ? 'hidden' : ''}>
          <GameWipeTab
            family="hytale"
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
