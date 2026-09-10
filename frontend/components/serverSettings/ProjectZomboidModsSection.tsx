import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Loader2, Plus, Trash2, X } from 'lucide-react';
import { AppButton, AppModal, AppModalBody, AppModalContent, AppModalHeader, AppModalTitle, AppToggle } from '../../src/ui/components';
import { useTheme } from '../../contexts/ThemeContext';
import { apiClient } from '../../utils/api';
import type { ProjectZomboidMod, ProjectZomboidModId } from '../../types/projectZomboid';

export interface ProjectZomboidModsSectionProps {
  serverId: number;
  serverStatus?: string | null;
  canRead: boolean;
  canWrite: boolean;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

function parseIds(raw: string): string[] {
  return Array.from(new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)));
}

function errorMessage(err: any, fallback: string): string {
  return err?.response?.data?.error || err?.message || fallback;
}

function workshopUrl(workshopId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(workshopId)}`;
}

function Tags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, 5).map((tag) => (
        <span key={tag} className="rounded-full bg-gp-surface-elevated px-2 py-0.5 text-[10px] font-medium text-gray-400">
          {tag}
        </span>
      ))}
    </div>
  );
}

// One internal Mod ID inside an item — individually toggleable. Not draggable:
// the load order of mod ids inside a single Workshop item is fixed.
function ModIdRow({
  modId,
  disabled,
  onToggle,
  borderColor,
  textPrimary,
}: {
  modId: ProjectZomboidModId;
  disabled: boolean;
  onToggle: (modId: ProjectZomboidModId) => void;
  borderColor: string;
  textPrimary: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border ${borderColor} bg-gp-surface-elevated/50 px-2 py-1.5`}
    >
      <span className={`flex-1 truncate font-mono text-xs ${modId.enabled ? textPrimary : 'text-gray-500 line-through'}`}>
        {modId.id}
      </span>
      <AppToggle
        ariaLabel={`Enable ${modId.id}`}
        checked={modId.enabled}
        onChange={() => onToggle(modId)}
        disabled={disabled}
        size="compact"
      />
    </div>
  );
}

const ModRow = memo(function ModRow({
  mod,
  index,
  total,
  disabled,
  busy,
  canWrite,
  onToggleItem,
  onRemove,
  onToggleModId,
  onMove,
  borderColor,
  textPrimary,
  textSecondary,
}: {
  mod: ProjectZomboidMod;
  index: number;
  total: number;
  disabled: boolean;
  busy: boolean;
  canWrite: boolean;
  onToggleItem: (mod: ProjectZomboidMod) => void;
  onRemove: (mod: ProjectZomboidMod) => void;
  onToggleModId: (mod: ProjectZomboidMod, modId: ProjectZomboidModId) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
}) {
  const showSubList = mod.modIds.length > 1;
  const canReorder = canWrite && !disabled;

  return (
    <div
      className={`rounded-xl border ${borderColor} bg-gp-surface-base/45 p-2.5 ${mod.enabled ? '' : 'opacity-55'}`}
    >
      <div className="group flex items-center gap-3">
        {canWrite && (
          <div className="flex flex-shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => onMove(index, -1)}
              disabled={!canReorder || index === 0}
              aria-label="Move up"
              className="flex h-5 w-5 items-center justify-center rounded-md border border-gray-700/70 bg-gp-surface-elevated/50 text-gray-400 transition-all hover:border-[var(--color-cyan-400)]/70 hover:text-[var(--color-cyan-400)] hover:shadow-[0_0_10px_-2px_var(--color-cyan-400)] active:scale-90 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-transparent disabled:text-gray-700 disabled:shadow-none"
            >
              <ChevronUp className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => onMove(index, 1)}
              disabled={!canReorder || index === total - 1}
              aria-label="Move down"
              className="flex h-5 w-5 items-center justify-center rounded-md border border-gray-700/70 bg-gp-surface-elevated/50 text-gray-400 transition-all hover:border-[var(--color-cyan-400)]/70 hover:text-[var(--color-cyan-400)] hover:shadow-[0_0_10px_-2px_var(--color-cyan-400)] active:scale-90 disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-transparent disabled:text-gray-700 disabled:shadow-none"
            >
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
        )}

        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gp-surface-elevated">
          {mod.previewUrl && (
            <img src={mod.previewUrl} alt="" className={`h-full w-full object-cover ${mod.enabled ? '' : 'grayscale'}`} />
          )}
          <span className="absolute left-0 top-0 rounded-br-md bg-black/60 px-1 text-[10px] font-semibold text-gray-200">
            {index + 1}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={`truncate text-sm font-semibold ${textPrimary}`}>
              {mod.title || `Workshop ${mod.workshopId}`}
            </p>
            <a
              href={workshopUrl(mod.workshopId)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-gray-500 opacity-0 transition-opacity hover:text-[var(--color-cyan-400)] group-hover:opacity-100"
              title="Open on Steam"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className={`truncate text-xs ${textSecondary}`}>
            #{mod.workshopId} · {mod.modIds.length === 1 ? mod.modIds[0].id : `${mod.modIds.length} mods`}
          </p>
          <Tags tags={mod.tags} />
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <AppToggle
            ariaLabel={`Enable ${mod.title || mod.workshopId}`}
            checked={mod.enabled}
            onChange={() => onToggleItem(mod)}
            disabled={disabled || busy}
            size="compact"
          />
          {canWrite && (
            <AppButton
              tone="ghost"
              onClick={() => onRemove(mod)}
              disabled={disabled || busy}
              aria-label="Remove mod"
              className="h-7 w-7 min-w-0 !min-h-0 rounded p-0 text-gray-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </AppButton>
          )}
        </div>
      </div>

      {showSubList && (
        <div className="ml-9 mt-2 space-y-1">
          {mod.modIds.map((m) => (
            <ModIdRow
              key={m.id}
              modId={m}
              disabled={disabled || busy}
              onToggle={(x) => onToggleModId(mod, x)}
              borderColor={borderColor}
              textPrimary={textPrimary}
            />
          ))}
        </div>
      )}
    </div>
  );
}, (prev, next) =>
  prev.mod === next.mod &&
  prev.index === next.index &&
  prev.total === next.total &&
  prev.disabled === next.disabled &&
  prev.busy === next.busy &&
  prev.canWrite === next.canWrite &&
  prev.borderColor === next.borderColor &&
  prev.textPrimary === next.textPrimary &&
  prev.textSecondary === next.textSecondary
);

// Steam Workshop mods manager for Project Zomboid. Mutations require the server
// to be stopped (backend returns 409 otherwise). Adding is a bulk operation: the
// user pastes Workshop ids and the backend resolves each item's mod ids from the
// Workshop item info, falling back to SteamCMD when needed (synchronous, can take
// seconds). Changes apply on the next start.
export function ProjectZomboidModsSection({
  serverId,
  serverStatus,
  canRead,
  canWrite,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: ProjectZomboidModsSectionProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [mods, setMods] = useState<ProjectZomboidMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const addTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [workshopIdsText, setWorkshopIdsText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{ added: string[]; failed: string[]; skipped: string[] } | null>(null);

  const isRunning = serverStatus === 'running';
  const canMutate = canWrite && !isRunning;

  const load = async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getProjectZomboidMods(serverId);
      setMods(data.mods ?? []);
    } catch (err: any) {
      setError(errorMessage(err, 'Failed to load mods.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = addTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [workshopIdsText, addOpen]);

  const runMutation = async (fn: () => Promise<{ mods: ProjectZomboidMod[] }>, fallback: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const data = await fn();
      setMods(data.mods ?? []);
      return true;
    } catch (err: any) {
      setError(errorMessage(err, fallback));
      void load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    const ids = parseIds(workshopIdsText);
    if (ids.length === 0 || adding || !canMutate) return;
    setAdding(true);
    setError(null);
    setAddResult(null);
    try {
      const data = await apiClient.addProjectZomboidMods(serverId, ids);
      setMods(data.mods ?? []);
      const result = { added: data.added ?? [], failed: data.failed ?? [], skipped: data.skipped ?? [] };
      setAddResult(result);
      setWorkshopIdsText(result.failed.join('\n'));
      if (result.failed.length === 0) setAddOpen(false);
    } catch (err: any) {
      setError(errorMessage(err, 'Failed to add mods.'));
    } finally {
      setAdding(false);
    }
  };

  const handleToggleItem = (mod: ProjectZomboidMod) =>
    runMutation(
      () => apiClient.patchProjectZomboidMod(serverId, mod.workshopId, { enabled: !mod.enabled }),
      'Failed to update mod.'
    );

  const handleToggleModId = (mod: ProjectZomboidMod, modId: ProjectZomboidModId) =>
    runMutation(
      () => apiClient.patchProjectZomboidMod(serverId, mod.workshopId, {
        modIds: mod.modIds.map((m) => (m.id === modId.id ? { ...m, enabled: !m.enabled } : m)),
      }),
      'Failed to update mod.'
    );

  const handleRemove = (mod: ProjectZomboidMod) =>
    runMutation(() => apiClient.deleteProjectZomboidMod(serverId, mod.workshopId), 'Failed to remove mod.');

  const handleMoveItem = (index: number, direction: -1 | 1) => {
    if (busy) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= mods.length) return;
    const reordered = mods.slice();
    const [item] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, item);
    setMods(reordered);
    void runMutation(
      () => apiClient.reorderProjectZomboidMods(serverId, reordered.map((m) => m.workshopId)),
      'Failed to reorder mods.'
    );
  };

  if (!canRead) return null;

  const parsedCount = parseIds(workshopIdsText).length;
  const canSubmitAdd = canMutate && !adding && parsedCount > 0;

  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className={`text-base font-semibold ${textPrimary}`}>Steam Workshop Mods</h4>
          {mods.length > 0 && (
            <span className="rounded-full bg-gp-surface-elevated px-2 py-0.5 text-xs font-semibold text-gray-400">
              {mods.length}
            </span>
          )}
        </div>
        {canWrite && (
          <AppButton
            tone="primary"
            onClick={() => { setWorkshopIdsText(''); setAddResult(null); setAddOpen(true); }}
            disabled={!canMutate}
            className="inline-flex h-8 items-center gap-1.5 px-3 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add mods
          </AppButton>
        )}
      </div>

      {isRunning && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>The server must be stopped to change mods. Mod changes apply on the next start.</span>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <AppModal open={addOpen && canWrite} onOpenChange={(open) => { if (!open && !adding) setAddOpen(false); }}>
        <AppModalContent
          dismissible={false}
          className={`z-[61] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-xl border p-4 shadow-2xl md:p-6 ${
            isDark ? 'border-white/10 bg-[#0d1524]' : 'border-[#e2e8f0] bg-white'
          }`}
        >
          <AppModalBody className="overflow-x-hidden">
            <AppModalHeader className="mb-3 flex items-center justify-between">
              <AppModalTitle>Add Workshop mods</AppModalTitle>
              <AppButton
                tone="ghost"
                onClick={() => setAddOpen(false)}
                disabled={adding}
                aria-label="Close"
                className="h-7 w-7 min-w-0 !min-h-0 rounded p-0 text-gray-400 hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </AppButton>
            </AppModalHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className={`text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>Workshop IDs</label>
                <textarea
                  ref={addTextareaRef}
                  value={workshopIdsText}
                  onChange={(e) => setWorkshopIdsText(e.target.value)}
                  placeholder={'Paste one or more Workshop IDs\n(comma, space or new line separated)\ne.g. 2200148440, 2169435993'}
                  disabled={!canMutate || adding}
                  spellCheck={false}
                  className="w-full resize-none min-h-[76px] overflow-hidden px-3 py-2 bg-gp-surface-elevated border border-gray-600 rounded-lg text-white text-sm font-mono focus:outline-none disabled:opacity-60"
                />
              </div>

              {addResult && (
                <div className="space-y-0.5 text-xs">
                  {addResult.added.length > 0 && (
                    <p className="text-emerald-400">Added: {addResult.added.join(', ')}</p>
                  )}
                  {addResult.skipped.length > 0 && (
                    <p className={textSecondary}>Already present: {addResult.skipped.join(', ')}</p>
                  )}
                  {addResult.failed.length > 0 && (
                    <p className="text-red-400">Failed to resolve (kept above to retry): {addResult.failed.join(', ')}</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <AppButton
                  tone="neutral"
                  onClick={() => setAddOpen(false)}
                  disabled={adding}
                  className="inline-flex !h-9 !min-h-0 min-w-[104px] items-center justify-center gap-1.5 px-4 rounded-lg text-sm font-medium disabled:opacity-60"
                >
                  Cancel
                </AppButton>
                <AppButton
                  tone="primary"
                  onClick={handleAdd}
                  disabled={!canSubmitAdd}
                  className="inline-flex !h-9 !min-h-0 min-w-[104px] items-center justify-center gap-1.5 px-4 rounded-lg text-sm font-medium disabled:opacity-60"
                >
                  {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  {adding ? 'Resolving mods…' : `Add${parsedCount > 1 ? ` ${parsedCount} mods` : ' mod'}`}
                </AppButton>
              </div>
            </div>
          </AppModalBody>
        </AppModalContent>
      </AppModal>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading mods…
        </div>
      ) : mods.length === 0 ? (
        <div className={`flex flex-col items-center gap-2 rounded-xl border border-dashed ${borderColor} py-8 text-center`}>
          <p className={`text-sm ${textSecondary}`}>No Workshop mods yet.</p>
          {canWrite && !addOpen && (
            <AppButton
              tone="ghost"
              onClick={() => { setAddOpen(true); setWorkshopIdsText(''); setAddResult(null); }}
              disabled={!canMutate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--color-cyan-400)] hover:bg-gray-700 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Add your first mods
            </AppButton>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {mods.map((mod, index) => (
            <ModRow
              key={mod.workshopId}
              mod={mod}
              index={index}
              total={mods.length}
              disabled={!canMutate || busy}
              busy={busy}
              canWrite={canWrite}
              onToggleItem={(m) => void handleToggleItem(m)}
              onRemove={(m) => void handleRemove(m)}
              onToggleModId={(m, x) => void handleToggleModId(m, x)}
              onMove={handleMoveItem}
              borderColor={borderColor}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
