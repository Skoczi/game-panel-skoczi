import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { OvhcloudSettingsSection } from './OvhcloudSettingsSection';
import { MinecraftAddonsSection } from './MinecraftAddonsSection';
import { GameWipeTab } from './GameWipeTab';
import { buildWipeModes } from './wipeModes';
import { type McServerType } from '../../utils/minecraftCatalog';

type Operator = { uuid: string; name: string; level: number; bypassesPlayerLimit: boolean };
type WhitelistPlayer = { uuid: string; name: string };
type PlayerBan = { name: string; uuid?: string; reason?: string; created?: string; expires?: string; source?: string };
type IpBan = { ip: string; reason?: string; created?: string; expires?: string; source?: string };

export interface MinecraftSectionsProps {
  serverId: number;
  serverStatus?: string | null;
  canReadSettings: boolean;
  canWriteSettings: boolean;
  canReadFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  canReadOperators: boolean;
  canWriteOperators: boolean;
  canReadWhitelist: boolean;
  canWriteWhitelist: boolean;
  canReadBans: boolean;
  canWriteBans: boolean;
  canReadIpBans: boolean;
  canWriteIpBans: boolean;
  canReadAddons: boolean;
  canWriteAddons: boolean;
  canWipeSoft?: boolean;
  canWipeHard?: boolean;
  onReinstallStarted?: () => void;
  addonKind: 'plugins' | 'mods';
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
  mcServerType?: McServerType | null;
  canEditVersion?: boolean;
  canManageEnv?: boolean;
  containerConfigSaveCount?: number;
}

function SectionCard({ title, children, borderColor, contentBg, textPrimary }: {
  title: string;
  children: React.ReactNode;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
}) {
  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 space-y-3`}>
      <h4 className={`text-base font-semibold ${textPrimary}`}>{title}</h4>
      {children}
    </div>
  );
}

function ServerRunningWarning({ serverStatus }: { serverStatus?: string | null }) {
  if (serverStatus === 'running') return null;
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>The server must be <strong>running</strong> to use this feature.</span>
    </div>
  );
}

function ErrorMsg({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-red-400">{error}</p>;
}

const MC_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const validateMcName = (name: string) => MC_NAME_RE.test(name.trim());

function OperatorsSection({
  serverId, serverStatus, canRead, canWrite, isActive, borderColor, contentBg, textPrimary, textSecondary,
}: {
  serverId: number; serverStatus?: string | null; canRead: boolean; canWrite: boolean; isActive: boolean;
  borderColor: string; contentBg: string; textPrimary: string; textSecondary: string;
}) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingName, setRemovingName] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getMinecraftOperators(serverId);
      setOperators(data.operators);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load operators.');
    } finally {
      setLoading(false);
    }
  }, [serverId, canRead]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { void load(); }, []); // eslint-disable-line
  const firstActiveRef = useRef(true);
  useEffect(() => {
    if (firstActiveRef.current) { firstActiveRef.current = false; return; }
    if (isActive) void loadRef.current();
  }, [isActive]);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!canWrite || !validateMcName(name) || adding) return;
    setAdding(true);
    setError(null);
    try {
      await apiClient.addMinecraftOperator(serverId, name);
      setAddName('');
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to add operator.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (!canWrite || removingName) return;
    setRemovingName(name);
    setError(null);
    try {
      await apiClient.removeMinecraftOperator(serverId, name);
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to remove operator.');
    } finally {
      setRemovingName(null);
    }
  };

  const inputCls = `flex-1 bg-gp-surface-input border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-cyan-400)]`;
  const canWriteNow = canWrite && serverStatus === 'running';

  return (
    <SectionCard title="Operators" borderColor={borderColor} contentBg={contentBg} textPrimary={textPrimary}>
      <ServerRunningWarning serverStatus={serverStatus} />
      {loading && <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>}
      <ErrorMsg error={error} />
      {canWriteNow && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            className={inputCls}
            placeholder="Player name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
            maxLength={16}
          />
          <AppButton
            onClick={handleAdd}
            disabled={adding || !validateMcName(addName)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm flex-shrink-0"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Op
          </AppButton>
        </div>
      )}
      {!loading && operators.length === 0 && !error && (
        <p className={`text-sm ${textSecondary}`}>No operators configured.</p>
      )}
      {operators.length > 0 && (
        <div className="space-y-2">
          {operators.map((op) => (
            <div key={op.uuid} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${borderColor} bg-gray-900/30`}>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${textPrimary}`}>{op.name}</p>
                {op.bypassesPlayerLimit && <p className={`text-xs ${textSecondary}`}>Bypasses player limit</p>}
              </div>
              {canWriteNow && (
                <AppButton
                  tone="critical"
                  onClick={() => handleRemove(op.name)}
                  disabled={removingName === op.name}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0"
                >
                  {removingName === op.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Remove
                </AppButton>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function WhitelistSection({
  serverId, serverStatus, canRead, canWrite, isActive, borderColor, contentBg, textPrimary, textSecondary,
}: {
  serverId: number; serverStatus?: string | null; canRead: boolean; canWrite: boolean; isActive: boolean;
  borderColor: string; contentBg: string; textPrimary: string; textSecondary: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [players, setPlayers] = useState<WhitelistPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingName, setRemovingName] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getMinecraftWhitelist(serverId);
      setEnabled(data.whitelist.enabled);
      setPlayers(data.whitelist.players);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load whitelist.');
    } finally {
      setLoading(false);
    }
  }, [serverId, canRead]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { void load(); }, []); // eslint-disable-line
  const firstActiveRef = useRef(true);
  useEffect(() => {
    if (firstActiveRef.current) { firstActiveRef.current = false; return; }
    if (isActive) void loadRef.current();
  }, [isActive]);

  const handleToggle = async () => {
    if (!canWrite || toggling) return;
    setToggling(true);
    setError(null);
    try {
      await apiClient.patchMinecraftWhitelist(serverId, !enabled);
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to toggle whitelist.');
    } finally {
      setToggling(false);
    }
  };

  const handleAdd = async () => {
    const name = addName.trim();
    if (!canWrite || !validateMcName(name) || adding) return;
    setAdding(true);
    setError(null);
    try {
      await apiClient.addMinecraftWhitelistPlayer(serverId, name);
      setAddName('');
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to add player.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (!canWrite || removingName) return;
    setRemovingName(name);
    setError(null);
    try {
      await apiClient.removeMinecraftWhitelistPlayer(serverId, name);
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to remove player.');
    } finally {
      setRemovingName(null);
    }
  };

  const inputCls = `flex-1 bg-gp-surface-input border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-cyan-400)]`;
  const canWriteNow = canWrite && serverStatus === 'running';

  return (
    <SectionCard title="Whitelist" borderColor={borderColor} contentBg={contentBg} textPrimary={textPrimary}>
      <ServerRunningWarning serverStatus={serverStatus} />
      {loading && <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>}
      <ErrorMsg error={error} />
      {!loading && (
        <>
          <div className={`flex items-center justify-between p-3 rounded-lg border ${borderColor} bg-gray-900/30`}>
            <div>
              <p className={`text-sm font-medium ${textPrimary}`}>Whitelist enabled</p>
              <p className={`text-xs ${textSecondary}`}>Only whitelisted players and operators can join.</p>
            </div>
            <button
              type="button"
              onClick={handleToggle}
              disabled={!canWriteNow || toggling}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-gray-600'}`}
            >
              <span className={`absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow transition-all duration-200 ${enabled ? 'left-[19px]' : 'left-[3px]'}`} />
            </button>
          </div>
          {canWriteNow && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                className={inputCls}
                placeholder="Player name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
                maxLength={16}
              />
              <AppButton
                onClick={handleAdd}
                disabled={adding || !validateMcName(addName)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm flex-shrink-0"
              >
                {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Add
              </AppButton>
            </div>
          )}
          {players.length === 0 && !error && (
            <p className={`text-sm ${textSecondary}`}>No players on the whitelist.</p>
          )}
          {players.length > 0 && (
            <div className="space-y-2">
              {players.map((p) => (
                <div key={p.uuid} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${borderColor} bg-gray-900/30`}>
                  <p className={`text-sm font-medium ${textPrimary}`}>{p.name}</p>
                  {canWriteNow && (
                    <AppButton
                      tone="critical"
                      onClick={() => handleRemove(p.name)}
                      disabled={removingName === p.name}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0"
                    >
                      {removingName === p.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Remove
                    </AppButton>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

function PlayerBansSection({
  serverId, serverStatus, canRead, canWrite, isActive, borderColor, contentBg, textPrimary, textSecondary,
}: {
  serverId: number; serverStatus?: string | null; canRead: boolean; canWrite: boolean; isActive: boolean;
  borderColor: string; contentBg: string; textPrimary: string; textSecondary: string;
}) {
  const [bans, setBans] = useState<PlayerBan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banName, setBanName] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banning, setBanning] = useState(false);
  const [unbanningName, setUnbanningName] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getMinecraftPlayerBans(serverId);
      setBans(data.bans);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load bans.');
    } finally {
      setLoading(false);
    }
  }, [serverId, canRead]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { void load(); }, []); // eslint-disable-line
  const firstActiveRef = useRef(true);
  useEffect(() => {
    if (firstActiveRef.current) { firstActiveRef.current = false; return; }
    if (isActive) void loadRef.current();
  }, [isActive]);

  const handleBan = async () => {
    const name = banName.trim();
    if (!canWrite || !validateMcName(name) || banning) return;
    setBanning(true);
    setError(null);
    try {
      await apiClient.banMinecraftPlayer(serverId, name, banReason.trim() || undefined);
      setBanName('');
      setBanReason('');
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to ban player.');
    } finally {
      setBanning(false);
    }
  };

  const handleUnban = async (name: string) => {
    if (!canWrite || unbanningName) return;
    setUnbanningName(name);
    setError(null);
    try {
      await apiClient.unbanMinecraftPlayer(serverId, name);
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to unban player.');
    } finally {
      setUnbanningName(null);
    }
  };

  const inputCls = `bg-gp-surface-input border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-cyan-400)]`;
  const canWriteNow = canWrite && serverStatus === 'running';

  return (
    <SectionCard title="Player Bans" borderColor={borderColor} contentBg={contentBg} textPrimary={textPrimary}>
      <ServerRunningWarning serverStatus={serverStatus} />
      {loading && <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>}
      <ErrorMsg error={error} />
      {canWriteNow && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <input type="text" className={`${inputCls} flex-1`} placeholder="Player name" value={banName}
              onChange={(e) => setBanName(e.target.value)} maxLength={16} />
            <input type="text" className={`${inputCls} flex-1`} placeholder="Reason (optional)" value={banReason}
              onChange={(e) => setBanReason(e.target.value)} maxLength={512} />
            <AppButton
              tone="critical"
              onClick={handleBan}
              disabled={banning || !validateMcName(banName)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm flex-shrink-0"
            >
              {banning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Ban
            </AppButton>
          </div>
        </div>
      )}
      {!loading && bans.length === 0 && !error && (
        <p className={`text-sm ${textSecondary}`}>No player bans.</p>
      )}
      {bans.length > 0 && (
        <div className="space-y-2">
          {bans.map((ban) => (
            <div key={ban.name} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${borderColor} bg-gray-900/30`}>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${textPrimary}`}>{ban.name}</p>
                {ban.reason && <p className={`text-xs ${textSecondary} truncate`}>Reason: {ban.reason}</p>}
                {ban.created && <p className={`text-xs ${textSecondary}`}>{new Date(ban.created).toLocaleString()}</p>}
              </div>
              {canWriteNow && (
                <AppButton
                  tone="ghost"
                  onClick={() => handleUnban(ban.name)}
                  disabled={unbanningName === ban.name}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0 border border-gray-600"
                >
                  {unbanningName === ban.name ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Pardon
                </AppButton>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function IpBansSection({
  serverId, serverStatus, canRead, canWrite, isActive, borderColor, contentBg, textPrimary, textSecondary,
}: {
  serverId: number; serverStatus?: string | null; canRead: boolean; canWrite: boolean; isActive: boolean;
  borderColor: string; contentBg: string; textPrimary: string; textSecondary: string;
}) {
  const [bans, setBans] = useState<IpBan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banning, setBanning] = useState(false);
  const [unbanningIp, setUnbanningIp] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getMinecraftIpBans(serverId);
      setBans(data.bans);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load IP bans.');
    } finally {
      setLoading(false);
    }
  }, [serverId, canRead]);

  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { void load(); }, []); // eslint-disable-line
  const firstActiveRef = useRef(true);
  useEffect(() => {
    if (firstActiveRef.current) { firstActiveRef.current = false; return; }
    if (isActive) void loadRef.current();
  }, [isActive]);

  const handleBan = async () => {
    const target = banTarget.trim();
    if (!canWrite || !target || banning) return;
    setBanning(true);
    setError(null);
    try {
      await apiClient.banMinecraftIp(serverId, target, banReason.trim() || undefined);
      setBanTarget('');
      setBanReason('');
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to ban IP.');
    } finally {
      setBanning(false);
    }
  };

  const handleUnban = async (ip: string) => {
    if (!canWrite || unbanningIp) return;
    setUnbanningIp(ip);
    setError(null);
    try {
      await apiClient.unbanMinecraftIp(serverId, ip);
      setTimeout(() => void load(), 600);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to unban IP.');
    } finally {
      setUnbanningIp(null);
    }
  };

  const inputCls = `bg-gp-surface-input border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-cyan-400)]`;
  const canWriteNow = canWrite && serverStatus === 'running';

  return (
    <SectionCard title="IP Bans" borderColor={borderColor} contentBg={contentBg} textPrimary={textPrimary}>
      <ServerRunningWarning serverStatus={serverStatus} />
      {loading && <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />Loading...</div>}
      <ErrorMsg error={error} />
      {canWriteNow && (
        <div className="flex items-center gap-2 pt-1">
          <input type="text" className={`${inputCls} flex-1`} placeholder="IP address or player name"
            value={banTarget} onChange={(e) => setBanTarget(e.target.value)} />
          <input type="text" className={`${inputCls} flex-1`} placeholder="Reason (optional)"
            value={banReason} onChange={(e) => setBanReason(e.target.value)} maxLength={512} />
          <AppButton
            tone="critical"
            onClick={handleBan}
            disabled={banning || !banTarget.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm flex-shrink-0"
          >
            {banning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Ban
          </AppButton>
        </div>
      )}
      {!loading && bans.length === 0 && !error && (
        <p className={`text-sm ${textSecondary}`}>No IP bans.</p>
      )}
      {bans.length > 0 && (
        <div className="space-y-2">
          {bans.map((ban) => (
            <div key={ban.ip} className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${borderColor} bg-gray-900/30`}>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${textPrimary} font-mono`}>{ban.ip}</p>
                {ban.reason && <p className={`text-xs ${textSecondary} truncate`}>Reason: {ban.reason}</p>}
                {ban.created && <p className={`text-xs ${textSecondary}`}>{new Date(ban.created).toLocaleString()}</p>}
              </div>
              {canWriteNow && (
                <AppButton
                  tone="ghost"
                  onClick={() => handleUnban(ban.ip)}
                  disabled={unbanningIp === ban.ip}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0 border border-gray-600"
                >
                  {unbanningIp === ban.ip ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Pardon
                </AppButton>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

type MinecraftSubTab = 'settings' | 'operators' | 'whitelist' | 'bans' | 'ipbans' | 'addons' | 'wipe';

export function MinecraftSections({
  serverId,
  serverStatus,
  canReadSettings,
  canWriteSettings,
  canReadFileManager,
  onOpenFileManagerPath,
  canReadOperators,
  canWriteOperators,
  canReadWhitelist,
  canWriteWhitelist,
  canReadBans,
  canWriteBans,
  canReadIpBans,
  canWriteIpBans,
  canReadAddons,
  canWriteAddons,
  canWipeSoft,
  canWipeHard,
  onReinstallStarted,
  addonKind,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
  mcServerType,
  canEditVersion = false,
  canManageEnv = false,
}: MinecraftSectionsProps) {
  const addonLabel = addonKind === 'plugins' ? 'Plugins' : 'Mods';

  const canShowVersion = !!mcServerType && canManageEnv;

  const showWipeTab = buildWipeModes('minecraft', {
    canSoft: Boolean(canWipeSoft),
    canHard: Boolean(canWipeHard),
  }).length > 0;

  const tabs: { id: MinecraftSubTab; label: string }[] = [
    (canReadSettings || canShowVersion) && { id: 'settings', label: 'Settings' },
    canReadAddons     && { id: 'addons',     label: addonLabel },
    canReadOperators  && { id: 'operators',  label: 'Operators' },
    canReadWhitelist  && { id: 'whitelist',  label: 'Whitelist' },
    canReadBans       && { id: 'bans',       label: 'Player Bans' },
    canReadIpBans     && { id: 'ipbans',     label: 'IP Bans' },
    showWipeTab       && { id: 'wipe',       label: 'Wipe' },
  ].filter(Boolean) as { id: MinecraftSubTab; label: string }[];

  const firstTab = tabs[0]?.id ?? 'settings';
  const [activeTab, setActiveTab] = useState<MinecraftSubTab>(firstTab);
  const [visited, setVisited] = useState<Set<MinecraftSubTab>>(() => new Set([firstTab]));

  const switchTab = (id: MinecraftSubTab) => {
    setActiveTab(id);
    setVisited((prev) => new Set([...prev, id]));
  };

  const sectionProps = { serverId, serverStatus, borderColor, contentBg, textPrimary, textSecondary };

  return (
    <div>
      <div className={`flex flex-wrap border-b ${borderColor} mb-5 gap-0`}>
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

      {visited.has('settings') && (canReadSettings || canShowVersion) && (
        <div className={`space-y-4 ${activeTab !== 'settings' ? 'hidden' : ''}`}>
          <OvhcloudSettingsSection
            serverId={serverId}
            serverStatus={serverStatus}
            canWriteFile={canWriteSettings}
            canWriteLaunch={canEditVersion}
            canReadFileManager={canReadFileManager}
            onOpenFileManagerPath={onOpenFileManagerPath}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}
      {visited.has('operators') && canReadOperators && (
        <div className={activeTab !== 'operators' ? 'hidden' : ''}>
          <OperatorsSection {...sectionProps} canRead={canReadOperators} canWrite={canWriteOperators} isActive={activeTab === 'operators'} />
        </div>
      )}
      {visited.has('whitelist') && canReadWhitelist && (
        <div className={activeTab !== 'whitelist' ? 'hidden' : ''}>
          <WhitelistSection {...sectionProps} canRead={canReadWhitelist} canWrite={canWriteWhitelist} isActive={activeTab === 'whitelist'} />
        </div>
      )}
      {visited.has('bans') && canReadBans && (
        <div className={activeTab !== 'bans' ? 'hidden' : ''}>
          <PlayerBansSection {...sectionProps} canRead={canReadBans} canWrite={canWriteBans} isActive={activeTab === 'bans'} />
        </div>
      )}
      {visited.has('ipbans') && canReadIpBans && (
        <div className={activeTab !== 'ipbans' ? 'hidden' : ''}>
          <IpBansSection {...sectionProps} canRead={canReadIpBans} canWrite={canWriteIpBans} isActive={activeTab === 'ipbans'} />
        </div>
      )}
      {visited.has('addons') && canReadAddons && (
        <div className={activeTab !== 'addons' ? 'hidden' : ''}>
          <MinecraftAddonsSection
            serverId={serverId}
            serverStatus={serverStatus}
            canRead={canReadAddons}
            canWrite={canWriteAddons}
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
            family="minecraft"
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
