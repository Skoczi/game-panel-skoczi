import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { AppButton, InfoTip } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { isServerDownLike } from '../../utils/serverRuntime';
import { SettingField } from './SettingField';
import {
  groupSettings,
  initialEditValue,
  serializeSettingValue,
  type EditValue,
  type FileSettingsPolicy,
  type Setting,
  type SettingGroup,
  type SettingsScreen,
} from '../../utils/serverSettings';

interface OvhcloudSettingsSectionProps {
  serverId: number;
  serverStatus?: string | null;
  canWriteFile?: boolean;
  canWriteLaunch?: boolean;
  canReadFileManager?: boolean;
  onOpenFileManagerPath?: (path: string) => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type SectionKind = 'file' | 'launch';

function editsFrom(settings: Setting[]): Record<string, EditValue> {
  const out: Record<string, EditValue> = {};
  for (const s of settings) out[s.key] = initialEditValue(s);
  return out;
}

function changedKeys(settings: Setting[], edits: Record<string, EditValue>): string[] {
  return settings.filter((s) => edits[s.key] !== initialEditValue(s)).map((s) => s.key);
}

export function OvhcloudSettingsSection({
  serverId,
  serverStatus,
  canWriteFile = true,
  canWriteLaunch = true,
  canReadFileManager = false,
  onOpenFileManagerPath,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: OvhcloudSettingsSectionProps) {
  const [screen, setScreen] = useState<SettingsScreen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fileEdits, setFileEdits] = useState<Record<string, EditValue>>({});
  const [launchEdits, setLaunchEdits] = useState<Record<string, EditValue>>({});
  const [saving, setSaving] = useState<SectionKind | null>(null);
  const [sectionError, setSectionError] = useState<Record<SectionKind, string | null>>({ file: null, launch: null });
  const [sectionNote, setSectionNote] = useState<Record<SectionKind, string | null>>({ file: null, launch: null });
  const loaded = useRef(false);
  const refreshSeqRef = useRef<Record<string, number>>({});

  const running = !isServerDownLike(serverStatus ?? undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getServerSettings(serverId);
      setScreen(data);
      setFileEdits(editsFrom(data.fileSettings));
      setLaunchEdits(editsFrom(data.launchSettings));
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) setError('You do not have permission to view these settings.');
      else if (status === 501) setError('This server has no configurable settings.');
      else setError(err?.response?.data?.error || err?.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();
  }, [load]);

  const refreshDependents = useCallback(
    async (kind: SectionKind, parent: Setting, newValue: EditValue) => {
      if (!parent.refreshes?.length || !screen) return;
      const serialized = serializeSettingValue(parent, newValue);
      const param = serialized === null ? '' : String(serialized);
      for (const childKey of parent.refreshes) {
        const seq = (refreshSeqRef.current[childKey] ?? 0) + 1;
        refreshSeqRef.current[childKey] = seq;
        try {
          const res = await apiClient.getServerSettingOptions(serverId, childKey, { [parent.key]: param });
          // Changing the parent again before this resolves would otherwise let the older
          // answer land last and pin the child to a list its parent no longer matches.
          if (refreshSeqRef.current[childKey] !== seq) continue;
          setScreen((prev) => {
            if (!prev) return prev;
            const listKey = kind === 'file' ? 'fileSettings' : 'launchSettings';
            return {
              ...prev,
              [listKey]: prev[listKey].map((s) =>
                s.key === childKey ? { ...s, options: res.options, optionsUnavailable: false } : s),
            };
          });
          // The old value belonged to the old parent, and some of these lists are indexed
          // rather than named — CS2 game_mode 0 is Casual under one game type and Arms Race
          // under another — so keeping it would silently mean something else.
          const first = res.options[0];
          const nextEdits = kind === 'file' ? setFileEdits : setLaunchEdits;
          nextEdits((prev) => ({ ...prev, [childKey]: first ? String(first.value) : '' }));
        } catch {
          /* leave the stale options; the backend still validates on save */
        }
      }
    },
    [screen, serverId]
  );

  const onChange = (kind: SectionKind) => (key: string, value: EditValue) => {
    const setter = kind === 'file' ? setFileEdits : setLaunchEdits;
    setter((prev) => ({ ...prev, [key]: value }));
    setSectionNote((p) => ({ ...p, [kind]: null }));
    const list = kind === 'file' ? screen?.fileSettings : screen?.launchSettings;
    const parent = list?.find((s) => s.key === key);
    if (parent?.refreshes?.length) void refreshDependents(kind, parent, value);
  };

  const save = async (kind: SectionKind) => {
    if (!screen) return;
    const settings = kind === 'file' ? screen.fileSettings : screen.launchSettings;
    const edits = kind === 'file' ? fileEdits : launchEdits;

    // File settings can be blocked while the server runs on games that rewrite on shutdown (§12).
    if (kind === 'file' && running && screen.fileSettingsPolicy?.writableWhileRunning === false) {
      setSectionError((p) => ({ ...p, file: screen.fileSettingsPolicy?.writeBlockedReason ?? 'Stop the server before changing these settings.' }));
      return;
    }

    const keys = changedKeys(settings, edits);
    if (keys.length === 0) {
      setSectionNote((p) => ({ ...p, [kind]: 'No changes to save.' }));
      return;
    }
    const payload: Record<string, string | number | boolean | null> = {};
    for (const k of keys) {
      const s = settings.find((x) => x.key === k)!;
      payload[k] = serializeSettingValue(s, edits[k]);
    }

    setSaving(kind);
    setSectionError((p) => ({ ...p, [kind]: null }));
    setSectionNote((p) => ({ ...p, [kind]: null }));
    try {
      const res = kind === 'file'
        ? await apiClient.patchServerSettingsFile(serverId, payload)
        : await apiClient.patchServerSettingsLaunch(serverId, payload);
      setScreen((prev) => prev && { ...prev, [kind === 'file' ? 'fileSettings' : 'launchSettings']: res.settings });
      (kind === 'file' ? setFileEdits : setLaunchEdits)(editsFrom(res.settings));
      // Launch saves recreate the container and may restart it — never restart on our own (§3.3).
      const note = kind === 'launch'
        ? (res.restarted ? 'Saved — the server was recreated and restarted to apply.'
          : res.recreated ? 'Saved — will take effect the next time the server starts.'
          : 'Saved.')
        : (running ? 'Saved — restart the server to apply.' : 'Saved — will apply on next start.');
      setSectionNote((p) => ({ ...p, [kind]: note }));
    } catch (err: any) {
      const status = err?.response?.status;
      setSectionError((p) => ({ ...p, [kind]: status === 409
        ? (screen.fileSettingsPolicy?.writeBlockedReason ?? err?.response?.data?.error)
        : err?.response?.data?.error || err?.message || 'Save failed.' }));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
      </div>
    );
  }
  if (error) {
    return (
      <div className={`${contentBg} border ${borderColor} rounded-lg p-4 flex items-start gap-2 text-sm text-red-400`}>
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
      </div>
    );
  }
  if (!screen) return null;

  const hasFile = screen.fileSettings.length > 0;
  const hasLaunch = screen.launchSettings.length > 0;
  const visibleConfigFiles = screen.configFiles.filter((f) => f.exists);
  if (!hasFile && !hasLaunch && visibleConfigFiles.length === 0) {
    return (
      <div className={`${contentBg} border ${borderColor} rounded-lg p-4 text-sm ${textSecondary}`}>
        This server has no editable settings.
      </div>
    );
  }

  const renderSection = (
    kind: SectionKind,
    title: string,
    settings: Setting[],
    edits: Record<string, EditValue>,
    canWrite: boolean,
    policy?: FileSettingsPolicy
  ) => {
    if (settings.length === 0) return null;
    const grouped = groupSettings(settings, screen.groups);
    const blocked = kind === 'file' && running && policy?.writableWhileRunning === false;
    const dirty = changedKeys(settings, edits).length > 0;
    const err = sectionError[kind];
    const note = sectionNote[kind];

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${textSecondary}`}>{title}</h3>
          <AppButton tone="ghost" onClick={() => void load()} className="flex items-center gap-1.5 px-2 py-1 text-xs">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </AppButton>
        </div>

        {blocked && policy?.writeBlockedReason && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{policy.writeBlockedReason}</span>
          </div>
        )}

        {grouped.map(({ group, settings: groupItems }: { group: SettingGroup; settings: Setting[] }) => {
          return (
            <div key={group.id} className={`${contentBg} border ${borderColor} rounded-lg p-4 sm:p-5 space-y-4`}>
              <h4 className={`text-base font-semibold ${textPrimary}`}>{group.label}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {groupItems.map((s) => (
                  <SettingField
                    key={s.key}
                    setting={s}
                    value={edits[s.key] ?? initialEditValue(s)}
                    onChange={onChange(kind)}
                    disabled={!canWrite || (kind === 'file' && blocked)}
                    borderColor={borderColor}
                    textPrimary={textPrimary}
                    textSecondary={textSecondary}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-end gap-3">
          {err && <span className="text-xs text-red-400">{err}</span>}
          {!err && note && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> {note}
            </span>
          )}
          {canWrite && (
            <AppButton
              tone="primary"
              onClick={() => void save(kind)}
              disabled={saving === kind || blocked || !dirty}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
            >
              {saving === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save
            </AppButton>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {renderSection('file', 'Settings', screen.fileSettings, fileEdits, canWriteFile, screen.fileSettingsPolicy)}
      {renderSection('launch', 'Start parameters', screen.launchSettings, launchEdits, canWriteLaunch)}

      {visibleConfigFiles.length > 0 && (
        <div className="space-y-4">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${textSecondary}`}>Configuration files</h3>
          <div className="space-y-2">
            {visibleConfigFiles.map((f, i) => (
              <div
                key={f.path}
                className={`flex flex-col gap-2 md:flex-row md:items-center md:justify-between py-2 ${
                  i < visibleConfigFiles.length - 1 ? `border-b ${borderColor}` : ''
                }`}
              >
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-gray-500/40 text-gray-300 bg-gray-700/30 uppercase">
                    {f.format}
                  </span>
                  <span className={`text-sm font-mono break-all ${textPrimary}`}>{f.path}</span>
                  <InfoTip text={f.label} />
                </div>
                {canReadFileManager && onOpenFileManagerPath && (
                  <AppButton
                    tone="ghost"
                    onClick={() => onOpenFileManagerPath(f.path)}
                    className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border border-gray-600 hover:border-[var(--color-cyan-400)]/50"
                  >
                    <FolderOpen className="w-4 h-4" /> Open in File Manager
                  </AppButton>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
