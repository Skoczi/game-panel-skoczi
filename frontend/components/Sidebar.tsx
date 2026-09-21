import { useState, useRef, useEffect, type ReactNode } from 'react';
import { KeyRound, Moon, MoreVertical, Power, Sun, X, Settings, Server } from 'lucide-react';
import { useBranding } from '../contexts/BrandingContext';
import { PanelBrand } from './PanelBrand';
import { NodeSelector } from './NodeSelector';
import { ADMIN_RUNTIME, ACTIVE_SERVER, openFleet } from '../utils/nodeContext';
import { Icon, type IconName } from '@ovhcloud/ods-react';
import { formatDisplayVersion, getAppVersion } from '../utils/appInfo';
import type { AuthUser } from '../utils/permissions';
import { useTheme } from '../contexts/ThemeContext';
import {
  AppButton,
  AppModal,
  AppModalBody,
  AppModalContent,
  AppModalDescription,
  AppModalHeader,
  AppModalTitle,
} from '../src/ui/components';
import { PanelUpdateModal } from './PanelUpdateModal';
import { ApiTokensModal } from './ApiTokensModal';
import { apiClient, type PanelUpdateCheck } from '../utils/api';
import { useBodyScrollLock } from '../src/ui/utils/useBodyScrollLock';

interface SidebarProps {
  onNodeScopeChange?: (id: string) => void | Promise<void>;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onLogout?: () => void;
  onChangePassword?: () => void;
  canManageUsers?: boolean;
  staticLayout?: boolean;
  currentUser?: AuthUser | null;
}

function LegalSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-b border-white/10 pb-7 last:border-b-0 last:pb-0">
      <div className="border-l-2 border-[var(--color-cyan-400)] pl-4">
        <h3 className="text-lg font-semibold tracking-tight text-white">
          {number}. {title}
        </h3>
      </div>
      <div className="space-y-3 text-sm leading-6 text-slate-200">{children}</div>
    </section>
  );
}

function LegalSubheading({ children }: { children: ReactNode }) {
  return (
    <h4 className="pt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
      {children}
    </h4>
  );
}

function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 pl-5 text-slate-200 marker:text-slate-500">
      {items.map((item) => (
        <li key={item} className="list-disc">
          {item}
        </li>
      ))}
    </ul>
  );
}

interface UserMenuRowProps {
  onApiTokens: () => void;
  currentUserInitial: string;
  currentUserLabel: string;
  isDark: boolean;
  toggleTheme: () => void;
  onChangePassword?: () => void;
  onLogout?: () => void;
}

function UserMenuRow({
  onApiTokens,
  currentUserInitial,
  currentUserLabel,
  isDark,
  toggleTheme,
  onChangePassword,
  onLogout,
}: UserMenuRowProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <div className="gp-user-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold border-[#324666] bg-[#0f1a2b] text-[var(--color-cyan-400)]">
        {currentUserInitial}
      </div>
      <p
        className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-100"
        title={currentUserLabel}
      >
        {currentUserLabel}
      </p>
      <button
        type="button"
        onClick={toggleTheme}
        className={`cursor-pointer shrink-0 rounded-md p-1 transition-colors ${isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>
      <div
        ref={ref}
        className="relative shrink-0"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`cursor-pointer rounded-md p-1 transition-colors ${isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}
          aria-label="User menu"
          aria-haspopup="menu"
          aria-expanded={open}
          title="User menu"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {open && (
          <div
            className={`absolute bottom-full right-0 mb-3 w-44 overflow-hidden rounded-xl border shadow-lg ${isDark ? 'border-white/10 bg-[#0f1a2b]' : 'border-gray-200 bg-white'}`}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onChangePassword?.();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${isDark ? 'text-[#eef4fa] hover:bg-[#1c2e47]' : 'text-gray-800 hover:bg-gray-100'}`}
            >
              <KeyRound className="h-4 w-4 text-[var(--color-cyan-400)]" />
              Change password
            </button>
            <button type="button" onClick={() => { setOpen(false); onApiTokens(); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors ${isDark ? 'text-[#eef4fa] hover:bg-[#1c2e47]' : 'text-gray-800 hover:bg-gray-100'}`}>
              <KeyRound className="h-4 w-4 text-[var(--color-cyan-400)]" />API tokens
            </button>
            <div className={`mx-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`} />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout?.();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-medium text-[#e86180] transition-colors ${isDark ? 'hover:bg-[#291126]' : 'hover:bg-red-50'}`}
            >
              <Power className="h-4 w-4" />
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  onNodeScopeChange,
  activeTab,
  onTabChange,
  onLogout,
  onChangePassword,
  canManageUsers = true,
  staticLayout = false,
  currentUser = null,
}: SidebarProps) {
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);
  const [isApiTokensOpen, setIsApiTokensOpen] = useState(false);
  const [isEasterEggOpen, setIsEasterEggOpen] = useState(false);
  useBodyScrollLock(isLegalModalOpen || isEasterEggOpen);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [isPanelUpdateOpen, setIsPanelUpdateOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<PanelUpdateCheck | null>(null);
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const layoutClasses = staticLayout ? 'relative h-full' : 'fixed left-0 top-0 h-screen';
  const widthClasses = staticLayout ? 'w-full' : 'w-52';
  const currentUserLabel = currentUser?.username || 'Unknown user';
  const currentUserInitial = currentUserLabel.trim().charAt(0).toUpperCase() || '?';
  const appVersion = getAppVersion();
  const versionLabel = (
    <>
      <span className="block text-[11px] leading-4">Game Panel PRO</span>
      <span
        className="mt-1 block whitespace-nowrap text-[11px] tracking-wide tabular-nums"
        data-testid="panel-revision"
      >
        {formatDisplayVersion(appVersion)}
      </span>
    </>
  );
  const { appearance } = useBranding();

  useEffect(() => {
    if (!currentUser?.isRoot) return;
    apiClient
      .checkPanelUpdate()
      .then(setUpdateInfo)
      .catch(() => {});
  }, [currentUser?.isRoot]);

  const menuItems: Array<{ id: string; label: string; iconName: IconName; disabled?: boolean }> = [
    { id: 'game-servers', label: 'Game Servers', iconName: 'game-controller-alt' },
  ];
  if (canManageUsers)
    menuItems.push({ id: 'admin-users', label: 'User Administration', iconName: 'user' });
  if (currentUser?.isRoot) {
    menuItems.push({ id: 'nodes', label: 'Nodes', iconName: 'book' });
    menuItems.push({ id: 'game-templates', label: 'Game Templates', iconName: 'book' });
    menuItems.push({ id: 'settings', label: 'Panel Settings', iconName: 'book' });
    menuItems.push({ id: 'host-status', label: 'Host Status', iconName: 'analysis' });
  }

  return (
    <aside
      className={`${widthClasses} border-r flex flex-col ${layoutClasses} overflow-y-auto ${isDark ? 'border-white/10 bg-[#111827]' : 'border-[#000b82] bg-[#000e9c]'}`}
    >
      <div className={`border-b px-4 py-3 ${isDark ? 'border-white/10' : 'border-white/40'}`}>
        <div className="flex items-center justify-center">
          {/* Modified by Skoczi: independent fork identity; upstream credits retained. */}
          <button
            type="button"
            className="min-w-0 max-w-full text-white text-center font-semibold"
            onClick={() => {
              const next = logoClickCount + 1;
              if (next >= 5) {
                setIsEasterEggOpen(true);
                setLogoClickCount(0);
              } else {
                setLogoClickCount(next);
              }
            }}
          >
            <PanelBrand appearance={appearance} />
          </button>
        </div>
      </div>

      {currentUser?.isRoot && <NodeSelector onSelect={onNodeScopeChange} />}
      <nav className="gp-sidebar-nav p-2 flex-1">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;
          const isDisabled = Boolean(item.disabled);

          return (
            <AppButton
              key={item.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                if (isDisabled) return;
                if (item.id === 'game-servers' && (ACTIVE_SERVER || ADMIN_RUNTIME)) {
                  openFleet();
                  return;
                }
                onTabChange(item.id);
              }}
              disabled={isDisabled}
              tone={isActive ? 'secondary' : 'ghost'}
              className={`mb-1 flex w-full items-center justify-start gap-3 rounded-lg px-4 py-3 text-left transition-colors ${
                isDisabled
                  ? isDark
                    ? 'text-gray-600 cursor-not-allowed opacity-60'
                    : 'text-white/30 cursor-not-allowed opacity-60'
                  : isActive
                    ? isDark
                      ? 'border-[var(--gp-primary-300)] bg-[var(--gp-primary-300)] text-[#031126] hover:border-[var(--gp-primary-200)] hover:bg-[var(--gp-primary-200)] hover:text-[#031126]'
                      : 'border-white/20 bg-white/90 text-[#00185e] font-semibold hover:bg-white'
                    : isDark
                      ? 'border-none bg-transparent text-gray-400 hover:bg-gray-800 hover:text-[var(--gp-primary-300)]'
                      : 'border-none bg-transparent text-white/80 hover:bg-white/15 hover:text-white'
              }`}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {item.id === 'settings' ? (
                  <Settings size={20} />
                ) : item.id === 'nodes' ? (
                  <Server size={20} />
                ) : (
                  <Icon name={item.iconName} className="text-lg leading-none" />
                )}
              </span>
              <span className="text-sm font-medium leading-none">{item.label}</span>
            </AppButton>
          );
        })}
      </nav>

      <div className="gp-sidebar-bottom">
        <div className="border-y bg-transparent px-2 py-2.5 border-white/10">
          <UserMenuRow
            onApiTokens={() => setIsApiTokensOpen(true)}
            currentUserInitial={currentUserInitial}
            currentUserLabel={currentUserLabel}
            isDark={isDark}
            toggleTheme={toggleTheme}
            onChangePassword={onChangePassword}
            onLogout={onLogout}
          />
        </div>

        <div className="border-t px-3 py-3 border-white/10">
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-center text-[10px] text-gray-500">
            {currentUser?.isRoot ? (
              <button
                type="button"
                onClick={() => setIsPanelUpdateOpen(true)}
                className="relative w-full rounded-sm px-1 text-xs transition-colors text-gray-400 hover:text-gray-200"
                title={`Version ${appVersion}${updateInfo?.updateAvailable ? ` — Update available: v${updateInfo.latestVersion}` : ' — Panel update'}`}
              >
                {versionLabel}
                {updateInfo?.updateAvailable && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-orange-400 ring-2 ring-[#000e9c] dark:ring-[#111827]" />
                )}
              </button>
            ) : (
              <span className="w-full text-xs text-gray-400" title={`Version ${appVersion}`}>
                {versionLabel}
              </span>
            )}
            <a
              href="https://github.com/ovh/game-panel"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-sm text-[9px] text-gray-400 transition-colors hover:text-gray-200"
            >
              Based on OVHcloud Game Panel <span aria-hidden="true">↗</span>
            </a>
            <button
              type="button"
              onClick={() => setIsLegalModalOpen(true)}
              className="rounded-sm px-1 text-[10px] transition-colors text-gray-500 hover:text-gray-300"
            >
              Legal
            </button>
            <a
              href="https://github.com/Skoczi/game-panel-skoczi/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm px-1 text-[10px] transition-colors text-gray-500 hover:text-gray-300"
            >
              Bug or feature?
            </a>
          </div>
        </div>
      </div>

      <AppModal
        open={isLegalModalOpen}
        closeOnInteractOutside={false}
        onOpenChange={setIsLegalModalOpen}
      >
        <AppModalContent
          dismissible={false}
          className={`w-full max-w-5xl overflow-hidden rounded-2xl border shadow-[0_30px_120px_rgba(0,0,0,0.25)] ${isDark ? 'border-white/10 bg-[#0d1524] shadow-[0_30px_120px_rgba(0,0,0,0.55)]' : 'border-[#e2e8f0] bg-white'}`}
        >
          <AppModalHeader
            className={`flex items-start justify-between border-b p-6 ${isDark ? 'border-white/10 bg-[#101a2d]' : 'border-[#e2e8f0] bg-[#f8fafc]'}`}
          >
            <div className="space-y-1">
              <AppModalTitle
                className={`text-2xl font-semibold tracking-tight ${isDark ? 'text-white' : 'text-[#0f172a]'}`}
              >
                Terms and Conditions, Terms of Use and Privacy Policy
              </AppModalTitle>
              <AppModalDescription className={isDark ? 'text-slate-400' : 'text-[#64748b]'}>
                Version in effect as of: 12/03/2026
              </AppModalDescription>
            </div>
            <AppButton
              type="button"
              tone="ghost"
              onClick={() => setIsLegalModalOpen(false)}
              className={`rounded border-none bg-transparent p-2 transition-colors ${isDark ? 'text-gray-400 hover:bg-gray-700 hover:text-red-400' : 'text-[#94a3b8] hover:bg-[#f0f4f8] hover:text-[#dc2626]'}`}
              aria-label="Close legal modal"
            >
              <X className="h-5 w-5" />
            </AppButton>
          </AppModalHeader>

          <AppModalBody className="max-h-[85vh] overflow-y-auto p-0">
            <div className="px-6 py-6">
              <p className="mb-6 rounded border border-gray-600 p-3 text-sm">
                Maintained by Skoczi. Not an official OVHcloud release. The notices below are
                inherited from the original project. Operators must provide their own deployment
                terms and privacy information. Fork modifications are documented at
                github.com/Skoczi/game-panel-skoczi.
              </p>
              <div className="space-y-6">
                <LegalSection number="1" title="Terms and conditions">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-3">
                      <LegalSubheading>Service editor</LegalSubheading>
                      <p>The &quot;OVHcloud Game Panel&quot; is edited by:</p>
                      <div className="space-y-1">
                        <p className="font-semibold text-white">OVHcloud SAS</p>
                        <p>SAS with a capital of EUR50 million</p>
                        <p>RCS Lille Metropole 424 761 419 00045</p>
                        <p>APE code 2620Z</p>
                        <p>VAT NO: FR 22 424 761 419</p>
                        <p>Head office: 2 rue Kellermann - 59100 Roubaix - France</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <LegalSubheading>Hosting</LegalSubheading>
                      <div className="space-y-1">
                        <p className="font-semibold text-white">OVH</p>
                        <p>2 rue Kellermann</p>
                        <p>59100 Roubaix - France</p>
                        <p>Website: https://www.ovhcloud.com</p>
                      </div>
                    </div>
                  </div>

                  <LegalSubheading>Technologies used</LegalSubheading>
                  <p>The Game Panel uses open-source software, including:</p>
                  <LegalList
                    items={[
                      'LinuxGSM for the installation and automated management of Linux game servers.',
                    ]}
                  />
                  <p>Such software shall remain subject to their respective licenses.</p>
                </LegalSection>

                <LegalSection number="2" title="General Terms and Conditions of Use (GTC)">
                  <LegalSubheading>Subject</LegalSubheading>
                  <p>
                    These General Terms and Conditions of Use govern access to and use of the
                    OVHcloud Game Panel service, an interface for managing, administering and
                    deploying game servers.
                  </p>
                  <p>Any use of the service implies full acceptance of these conditions.</p>
                </LegalSection>

                <LegalSection number="3" title="Account creation and management">
                  <p>Access to the service requires:</p>
                  <LegalList
                    items={[
                      'creating a user account',
                      'the use of authentication credentials',
                      'acceptance of these T&Cs',
                    ]}
                  />
                  <p>The user is solely responsible for:</p>
                  <LegalList
                    items={[
                      'the confidentiality of their login details',
                      'the activity carried out from his account',
                      'the security of its access.',
                    ]}
                  />
                  <p>
                    In the event of suspected unauthorized access, the user must immediately inform
                    the publisher.
                  </p>
                </LegalSection>

                <LegalSection number="4" title="User responsibility">
                  <p>
                    The user is fully responsible for the services, content and activities they
                    deploy via the Game Panel.
                  </p>
                  <p>This includes:</p>
                  <LegalList
                    items={[
                      'the game servers installed',
                      'files transferred',
                      'the plugins or mods used',
                      'the content accessible from the servers',
                    ]}
                  />
                  <p>The user guarantees that their use of the service complies with:</p>
                  <LegalList
                    items={[
                      'the legislation in force',
                      'intellectual property rights',
                      'game publisher conditions.',
                    ]}
                  />
                </LegalSection>

                <LegalSection number="5" title="Prohibitions">
                  <p>It is strictly forbidden to use the Game Panel to:</p>
                  <LegalList
                    items={[
                      'Host or distribute illegal content',
                      'infringe copyright or software licenses',
                      'distribute malware or malware',
                      'carry out cyber attacks (DDoS, scanning, intrusion)',
                      'exploit servers for spam or phishing',
                      'use pirated or unauthorized game servers',
                      'bypass the technical limitations of the service.',
                    ]}
                  />
                  <p>The publisher reserves the right to:</p>
                  <LegalList
                    items={[
                      'immediately suspend a service',
                      'restrict access to an account',
                      'delete all illegal content',
                      'Report abuse to the appropriate authorities.',
                    ]}
                  />
                </LegalSection>

                <LegalSection number="6" title="Responsibility for game servers">
                  <p>The Game Panel only provides a technical management tool.</p>
                  <p>The publisher does not intervene in:</p>
                  <LegalList
                    items={[
                      'user administration of the servers',
                      'game configuration',
                      'hosted content',
                      'managing communities or players.',
                    ]}
                  />
                  <p>The user is solely responsible for:</p>
                  <LegalList
                    items={[
                      'managing your server',
                      'Gaming license compliance',
                      'the activities of players connected to its servers',
                      'hosted data',
                    ]}
                  />
                </LegalSection>

                <LegalSection number="7" title="Limitation of Liability">
                  <p>The publisher cannot be held responsible, particularly in the event of:</p>
                  <LegalList
                    items={[
                      'data loss',
                      'incorrect server configuration',
                      'accidental deletion of files',
                      'improper use of the Game Panel (especially via the terminal)',
                      'interruption of gaming services',
                      'misuse by third parties',
                      "IT attacks targeting users' servers.",
                    ]}
                  />
                  <p>The user is responsible for setting up their own backups.</p>
                </LegalSection>

                <LegalSection number="8" title="Service availability">
                  <p>The publisher is working hard to ensure that the Game Panel is available.</p>
                  <p>However, the service may be interrupted for:</p>
                  <LegalList
                    items={[
                      'maintenance',
                      'updates',
                      'technical incidents',
                      'infrastructure constraints',
                      'force majeure.',
                    ]}
                  />
                  <p>No guarantee of permanent availability can be provided.</p>
                </LegalSection>

                <LegalSection number="9" title="Account suspension or deletion">
                  <p>The publisher reserves the right to suspend or delete a user account if:</p>
                  <LegalList
                    items={[
                      'breach of these conditions',
                      'abuse of the service',
                      'illegal activity',
                      'risk to the security of the platform.',
                    ]}
                  />
                  <p>This suspension may take place without notice.</p>
                </LegalSection>

                <LegalSection number="10" title="Intellectual property">
                  <p>All Game Panel elements including:</p>
                  <LegalList
                    items={['source code', 'graphical user interface', 'design', 'documentation']}
                  />
                  <p>are protected by intellectual property laws.</p>
                  <p>Unauthorized reproduction or modification is prohibited.</p>
                  <p>
                    The trademarks and licenses of the games remain the property of their respective
                    publishers.
                  </p>
                </LegalSection>

                <LegalSection number="11" title="Privacy Policy (GDPR)">
                  <LegalSubheading>Collected data</LegalSubheading>
                  <p>The Game Panel can collect the following data:</p>
                  <LegalList
                    items={[
                      'IP address',
                      'user ID',
                      'email address',
                      'system logs',
                      'technical information related to the servers.',
                    ]}
                  />
                  <p>This data is necessary for the operation and security of the service.</p>

                  <LegalSubheading>Purposes of processing</LegalSubheading>
                  <p>The data is used to:</p>
                  <LegalList
                    items={[
                      'allow access to the Game Panel',
                      'secure the platform',
                      'manage servers',
                      'Prevent abuse and intrusion',
                      'improve service performance.',
                    ]}
                  />

                  <LegalSubheading>Legal basis</LegalSubheading>
                  <p>Treatments are based on:</p>
                  <LegalList
                    items={[
                      'running the service',
                      'the legitimate interest of securing the platform.',
                    ]}
                  />

                  <LegalSubheading>Data conservation</LegalSubheading>
                  <p>The data is stored:</p>
                  <LegalList
                    items={[
                      "for the duration of the service's use",
                      'then for a reasonable period of time for security and legal obligations.',
                    ]}
                  />

                  <LegalSubheading>User rights</LegalSubheading>
                  <p>
                    In compliance with the General Data Protection Regulation (GDPR), users have the
                    following rights:
                  </p>
                  <LegalList
                    items={[
                      'right of access',
                      'right of rectification',
                      'right of deletion',
                      'right of opposition',
                      'right to restriction of processing.',
                    ]}
                  />
                  <p>Requests may be addressed to:</p>
                  <p>[contact email]</p>
                </LegalSection>

                <LegalSection number="12" title="Cookies">
                  <p>
                    The Game Panel may use technical cookies necessary for the platform to work, in
                    particular to:
                  </p>
                  <LegalList items={['authentication', 'Session management', 'security.']} />
                  <p>No advertising cookies are used.</p>
                </LegalSection>

                <LegalSection number="13" title="Modification of the conditions">
                  <p>The publisher reserves the right to modify these conditions at any time.</p>
                  <p>The applicable version is the one published in the Game Panel.</p>
                </LegalSection>

                <LegalSection number="15" title="Network protection and abuse (DDoS, attacks)">
                  <p>
                    The user agrees not to use the resources provided via the Game Panel to carry
                    out or facilitate computer attacks, including:
                  </p>
                  <LegalList
                    items={[
                      'Denial-of-service (DDoS or DoS) attacks',
                      'port scans or intrusion attempts',
                      'exploiting security vulnerabilities',
                      'Using malicious scripts or bots.',
                    ]}
                  />
                  <p>
                    In the event of an attack originating from or targeting a server managed via the
                    Game Panel, the publisher reserves the right to:
                  </p>
                  <LegalList
                    items={[
                      'temporarily suspend the service concerned',
                      'limit network traffic',
                      'block some connections',
                      'suspend or terminate the user account.',
                    ]}
                  />
                  <p>
                    These measures can be taken without notice to protect infrastructure, other
                    users, and third-party networks.
                  </p>
                  <p>
                    The user acknowledges that the hosting infrastructure operated mainly via
                    OVHcloud may apply their own security policies and network restrictions.
                  </p>
                </LegalSection>

                <LegalSection number="16" title="3rd party mods, plugins and content">
                  <p>
                    The Game Panel allows users to install or use third-party mods, plugins,
                    extensions or content for game servers.
                  </p>
                  <p>The user acknowledges that:</p>
                  <LegalList
                    items={[
                      'these contents are installed under his sole responsibility',
                      'the publisher does not guarantee compatibility, security or stability',
                      'Some mods or plugins can compromise the security or operation of the servers.',
                    ]}
                  />
                  <p>The publisher cannot be held liable for any damage resulting from:</p>
                  <LegalList
                    items={[
                      'a faulty plugin',
                      'a malicious mode',
                      'a third-party script',
                      'incorrect configuration by the user.',
                    ]}
                  />
                  <p>The user also agrees not to use violating content:</p>
                  <LegalList
                    items={['copyright', 'software licenses', "game publishers' terms of use."]}
                  />
                </LegalSection>

                <LegalSection number="17" title="Game licensing and publisher compliance">
                  <p>
                    The Game Panel enables the installation and management of video game servers,
                    especially via LinuxGSM.
                  </p>
                  <p>
                    However, the user remains fully responsible for complying with the licenses and
                    conditions of use of the installed games, including:
                  </p>
                  <LegalList
                    items={[
                      'game publisher licenses',
                      'Terms of use for distribution platforms',
                      'rules related to public or commercial servers.',
                    ]}
                  />
                  <p>The publisher of the Game Panel:</p>
                  <LegalList
                    items={[
                      'provides no game licenses',
                      'does not sell or distribute video games',
                      'is not affiliated with the game publishers installed via the platform.',
                    ]}
                  />
                  <p>
                    Any use of unauthorized, pirated or non-compliant versions of games is strictly
                    prohibited.
                  </p>
                  <p>
                    In the event of a violation of the publisher&apos;s terms or applicable laws,
                    the publisher reserves the right to:
                  </p>
                  <LegalList
                    items={[
                      'immediately suspend the server concerned',
                      'delete disputed content',
                      'suspend or delete the user account.',
                    ]}
                  />

                  <LegalSubheading>Contact</LegalSubheading>
                  <p>
                    If you have any questions regarding the service: contact OVHcloud customer
                    support via the OVHcloud Control Panel, or by calling 1007
                  </p>
                </LegalSection>
              </div>
            </div>
          </AppModalBody>
        </AppModalContent>
      </AppModal>

      <PanelUpdateModal
        isOpen={isPanelUpdateOpen}
        onClose={() => setIsPanelUpdateOpen(false)}
        updateInfo={updateInfo}
      />
      {isApiTokensOpen && <ApiTokensModal key={currentUser?.username} onClose={() => setIsApiTokensOpen(false)} />}

      <AppModal open={isEasterEggOpen} onOpenChange={setIsEasterEggOpen}>
        <AppModalContent
          dismissible={false}
          className="relative z-[61] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-lg p-0"
        >
          <div className="flex justify-end px-3 pt-3 pb-1">
            <button
              type="button"
              onClick={() => setIsEasterEggOpen(false)}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <AppModalBody className="!overflow-hidden px-6 pb-6 !pt-0">
            <div className="flex flex-col items-center gap-4 text-center">
              <div>
                <AppModalDescription className="text-xl font-bold text-gray-900 dark:text-white">
                  Meet the team behind the OVHcloud Game Panel!
                </AppModalDescription>
              </div>
              <img
                src="/GPteam.png"
                alt="OVHcloud Game Panel team"
                draggable={false}
                className="w-full rounded-lg object-contain select-none"
              />
            </div>
          </AppModalBody>
        </AppModalContent>
      </AppModal>
    </aside>
  );
}
