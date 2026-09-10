import { useState } from 'react';
import { OvhcloudSettingsSection } from './OvhcloudSettingsSection';
import { CS2FrameworksSection } from './CS2FrameworksTab';
import { GameWipeTab } from './GameWipeTab';
import { buildWipeModes } from './wipeModes';

type CS2SubTab = 'settings' | 'frameworks' | 'wipe';

export interface CS2SectionsProps {
  serverId: number;
  serverStatus?: string | null;
  canEdit: boolean;
  canWriteFrameworks: boolean;
  canWipeSoft?: boolean;
  canWipeHard?: boolean;
  onReinstallStarted?: () => void;
  canManageEnv: boolean;
  canReadFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
  inputBg: string;
  inputBorder: string;
}

export function CS2Sections({
  serverId,
  serverStatus,
  canEdit,
  canWriteFrameworks,
  canWipeSoft,
  canWipeHard,
  onReinstallStarted,
  canManageEnv,
  canReadFileManager,
  onOpenFileManagerPath,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: CS2SectionsProps) {
  const showWipeTab = buildWipeModes('counter-strike', {
    canSoft: Boolean(canWipeSoft),
    canHard: Boolean(canWipeHard),
  }).length > 0;

  const availableTabs: CS2SubTab[] = [
    ...(canManageEnv ? (['settings'] as CS2SubTab[]) : []),
    'frameworks',
    ...(showWipeTab ? (['wipe'] as CS2SubTab[]) : []),
  ];
  const [activeTab, setActiveTab] = useState<CS2SubTab>(availableTabs[0]);
  const [visited, setVisited] = useState<Set<CS2SubTab>>(() => new Set([availableTabs[0]]));

  const switchTab = (id: CS2SubTab) => {
    setActiveTab(id);
    setVisited((prev) => new Set([...prev, id]));
  };

  return (
    <div>
      <div className={`flex flex-wrap border-b ${borderColor} mb-3`}>
        {availableTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => switchTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-[var(--color-cyan-400)] text-white'
                : 'border-transparent text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            {tab === 'settings' ? 'Settings' : tab === 'frameworks' ? 'Frameworks' : 'Wipe'}
          </button>
        ))}
      </div>

      {canManageEnv && visited.has('settings') && (
        <div className={activeTab !== 'settings' ? 'hidden' : ''}>
          <OvhcloudSettingsSection
            serverId={serverId}
            serverStatus={serverStatus}
            canWriteLaunch={canEdit}
            canReadFileManager={canReadFileManager}
            onOpenFileManagerPath={onOpenFileManagerPath}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}

      {visited.has('frameworks') && (
        <div className={activeTab !== 'frameworks' ? 'hidden' : ''}>
          <CS2FrameworksSection
            serverId={serverId}
            serverStatus={serverStatus}
            canWrite={canWriteFrameworks}
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
            family="counter-strike"
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

export type CS2ConfigTabProps = CS2SectionsProps & { serverId?: number | null };
export function CS2ConfigTab(props: CS2ConfigTabProps) {
  if (!props.serverId) return null;
  return <CS2Sections {...props} serverId={props.serverId} />;
}
