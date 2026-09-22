import { AppOptionSelect } from '../../src/ui/components/AppOptionSelect';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FileCode2, Loader2, Package,
  RefreshCw, Search, Trash2, Upload, X,
} from 'lucide-react';
import { AppButton, AppToggle } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { RestartToApplyNote } from './RestartToApplyNote';
import { MinecraftAddonDetail } from './MinecraftAddonDetail';
import type {
  AddonContext, AddonSearchHit, AddonSearchResponse, InstalledAddon, InstalledResponse,
} from '../../utils/minecraftAddons';

interface MinecraftAddonsSectionProps {
  serverId: number;
  serverStatus?: string | null;
  canRead: boolean;
  canWrite: boolean;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

type UploadItem = { id: string; name: string; progress: number; error?: string; done: boolean };

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function prettyCategory(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' ');
}

const PAGE_SIZE = 20;

function AddonBrowser({
  serverId, context, canWrite, kindLabel, onInstalled, installedByProject,
  borderColor, contentBg, textPrimary, textSecondary,
}: {
  serverId: number;
  context: AddonContext;
  canWrite: boolean;
  kindLabel: string;
  onInstalled: () => void;
  installedByProject: Map<string, string | null>;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(context.sorts.includes('downloads') ? 'downloads' : (context.sorts[0] ?? 'relevance'));
  const [category, setCategory] = useState('');
  const [anyVersion, setAnyVersion] = useState(false);
  const [offset, setOffset] = useState(0);
  const [resp, setResp] = useState<AddonSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const browserRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.searchMinecraftAddons(serverId, {
        query: query.trim() || undefined,
        sort,
        category: category || undefined,
        anyVersion: anyVersion || undefined,
        offset: nextOffset,
        limit: PAGE_SIZE,
      });
      setResp(data);
      setOffset(data.offset);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Modrinth is unreachable. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [serverId, query, sort, category, anyVersion]);

  useEffect(() => {
    const t = setTimeout(() => { void runSearch(0); }, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [query, sort, category, anyVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const install = async (hit: AddonSearchHit) => {
    if (!canWrite || installing.has(hit.projectId)) return;
    setInstalling((prev) => new Set([...prev, hit.projectId]));
    try {
      await apiClient.installMinecraftAddon(serverId, hit.projectId);
      setInstalledIds((prev) => new Set([...prev, hit.projectId]));
      onInstalled();
    } catch {
      // Keep the button usable; a transient failure can be retried.
    } finally {
      setInstalling((prev) => { const s = new Set(prev); s.delete(hit.projectId); return s; });
    }
  };

  const goToPage = (nextOffset: number) => {
    void runSearch(nextOffset);
    requestAnimationFrame(() => {
      const el = browserRef.current;
      if (!el) return;
      const container = el.closest('.overflow-y-auto') as HTMLElement | null;
      if (container) {
        const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12;
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      } else {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  };

  const hits = resp?.hits ?? [];
  const total = resp?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  const detailInstalledMap = new Map(installedByProject);
  for (const id of installedIds) if (!detailInstalledMap.has(id)) detailInstalledMap.set(id, null);

  const selectCls = `rounded-lg bg-white dark:bg-[#0f1723]/60 border ${borderColor} ${textPrimary} text-sm pl-2.5 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 appearance-none cursor-pointer`;

  return (
    <>
    <div ref={browserRef} className={`${contentBg} border ${borderColor} rounded-xl overflow-hidden scroll-mt-4`}>
        <div className={`flex items-center gap-2 border-b ${borderColor} px-4 py-3`}>
          <Search className="w-4 h-4 text-gray-400" />
          <h4 className={`text-sm font-semibold ${textPrimary}`}>Browse {kindLabel} on Modrinth</h4>
        </div>

        <div className={`flex flex-wrap items-center gap-2 border-b ${borderColor} px-4 py-3`}>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kindLabel.toLowerCase()}…`}
              className={`w-full rounded-lg bg-white dark:bg-[#0f1723]/60 border ${borderColor} ${textPrimary} text-sm pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40`}
            />
          </div>
          <div className="relative">
            <AppOptionSelect className={selectCls} value={sort} onChange={(selectedValue) => setSort(selectedValue)}>
              {context.sorts.map((s) => <option key={s} value={s}>{prettyCategory(s)}</option>)}
            </AppOptionSelect>
          </div>
          {context.categories.length > 0 && (
            <div className="relative">
              <AppOptionSelect className={selectCls} value={category} onChange={(selectedValue) => setCategory(selectedValue)}>
                <option value="">All categories</option>
                {context.categories.map((c) => <option key={c} value={c}>{prettyCategory(c)}</option>)}
              </AppOptionSelect>
            </div>
          )}
          <label className={`flex items-center gap-1.5 text-xs ${textSecondary} cursor-pointer select-none whitespace-nowrap`}>
            <AppToggle ariaLabel="Show all Minecraft versions" checked={anyVersion} onChange={setAnyVersion} />
            All Minecraft versions
          </label>
        </div>

        {!context.versionFilterAvailable && (
          <div className="flex items-start gap-2 px-4 py-2 text-xs text-amber-600 dark:text-amber-300 border-b border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Showing results for every Minecraft version — the server’s version could not be determined.
          </div>
        )}

        <div className="p-4">
          {loading && hits.length === 0 && (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching…
            </div>
          )}
          {!loading && error && (
            <div className="flex items-start gap-2 px-3 py-3 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
          {!loading && !error && hits.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-400">No results.</div>
          )}
          {hits.length > 0 && (
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
              {hits.map((hit) => {
                const isInstalled = hit.installed || installedIds.has(hit.projectId);
                const busy = installing.has(hit.projectId);
                return (
                  <div key={hit.projectId} className={`flex flex-col gap-2 rounded-xl border ${borderColor} p-3`}>
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-lg bg-gray-700/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {hit.iconUrl
                          ? <img src={hit.iconUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          : <Package className="w-5 h-5 text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setDetailId(hit.projectId)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm font-semibold truncate ${textPrimary} hover:underline`}>{hit.title}</span>
                          {!hit.compatible && (
                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 dark:text-amber-300 border border-amber-500/30">Incompatible</span>
                          )}
                        </div>
                        <p className={`text-xs truncate ${textSecondary}`}>by {hit.author}</p>
                      </div>
                    </div>
                    <p
                      className={`text-xs ${textSecondary} line-clamp-2 min-h-[2rem] cursor-pointer`}
                      onClick={() => setDetailId(hit.projectId)}
                    >
                      {hit.description}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <span className={`text-[11px] ${textSecondary}`}>↓ {formatCount(hit.downloads)} · ♥ {formatCount(hit.follows)}</span>
                      {canWrite && (
                        <AppButton
                          tone={isInstalled ? 'ghost' : 'primary'}
                          onClick={() => void install(hit)}
                          disabled={isInstalled || busy}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-60 whitespace-nowrap"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isInstalled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                          {isInstalled ? 'Installed' : 'Install'}
                        </AppButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {total > PAGE_SIZE && (
          <div className={`flex items-center justify-between gap-3 border-t ${borderColor} px-4 py-3`}>
            <span className={`text-xs ${textSecondary}`}>{from}–{to} of {total}</span>
            <div className="flex items-center gap-2">
              <AppButton tone="ghost" disabled={offset === 0 || loading} onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))} className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-40">Previous</AppButton>
              <AppButton tone="ghost" disabled={to >= total || loading} onClick={() => goToPage(offset + PAGE_SIZE)} className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-40">Next</AppButton>
            </div>
          </div>
        )}
    </div>
    {detailId && (
      <MinecraftAddonDetail
        serverId={serverId}
        projectId={detailId}
        anyVersion={anyVersion}
        canWrite={canWrite}
        installedByProject={detailInstalledMap}
        onInstalled={() => { onInstalled(); void runSearch(offset); }}
        onClose={() => setDetailId(null)}
        borderColor={borderColor}
        contentBg={contentBg}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
      />
    )}
    </>
  );
}

export function MinecraftAddonsSection({
  serverId, serverStatus, canRead, canWrite,
  borderColor, contentBg, textPrimary, textSecondary,
}: MinecraftAddonsSectionProps) {
  const [data, setData] = useState<InstalledResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notSupported, setNotSupported] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const context = data?.context ?? null;
  const label = context?.kind === 'plugins' ? 'Plugins' : 'Mods';
  const singular = context?.kind === 'plugins' ? 'plugin' : 'mod';
  const catalogAvailable = data?.catalogAvailable ?? false;
  const updateCheckAvailable = data?.updateCheckAvailable ?? false;
  const addons = data?.addons ?? [];
  const installedByProject = new Map<string, string | null>();
  for (const a of addons) if (a.projectId) installedByProject.set(a.projectId, a.versionId);

  const load = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    setNotSupported(false);
    try {
      const res = await apiClient.getMinecraftInstalledAddons(serverId);
      setData(res);
    } catch (err: any) {
      if (err?.response?.status === 501) setNotSupported(true);
      else setError(err?.response?.data?.error || err?.message || 'Failed to load addons.');
    } finally {
      setLoading(false);
    }
  }, [serverId, canRead]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load();
  }, [load]);

  const markBusy = (key: string, on: boolean) =>
    setBusy((prev) => { const s = new Set(prev); if (on) s.add(key); else s.delete(key); return s; });

  const handleFiles = useCallback(async (files: File[]) => {
    if (!canWrite || files.length === 0) return;
    const newItems: UploadItem[] = files.map((f) => ({
      id: `${Date.now()}-${Math.random()}-${f.name}`, name: f.name, progress: 0, done: false,
    }));
    setUploadQueue((prev) => [...prev, ...newItems]);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const item = newItems[i];
      try {
        await apiClient.uploadMinecraftAddon(serverId, file, (pct) =>
          setUploadQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, progress: pct } : q)));
        setUploadQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, progress: 100, done: true } : q));
        setRestartNeeded(true);
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || 'Upload failed.';
        setUploadQueue((prev) => prev.map((q) => q.id === item.id ? { ...q, error: msg, done: true } : q));
      }
    }
    await load();
    setTimeout(() => setUploadQueue((prev) => prev.filter((q) => !q.done || Boolean(q.error))), 3000);
  }, [serverId, canWrite, load]);

  const handleDelete = async (fileName: string) => {
    if (!canWrite) return;
    markBusy(fileName, true);
    try {
      await apiClient.deleteMinecraftAddons(serverId, [`/${fileName}`]);
      setRestartNeeded(true);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || `Failed to delete ${fileName}.`);
    } finally {
      markBusy(fileName, false);
    }
  };

  const toggleSelect = (fileName: string) =>
    setSelected((prev) => { const s = new Set(prev); if (s.has(fileName)) s.delete(fileName); else s.add(fileName); return s; });

  const handleDeleteMany = async () => {
    if (!canWrite || selected.size === 0) return;
    setBulkDeleting(true);
    try {
      // The backend batches up to 50 paths per call; chunk larger selections.
      const paths = [...selected].map((f) => `/${f}`);
      for (let i = 0; i < paths.length; i += 50) {
        await apiClient.deleteMinecraftAddons(serverId, paths.slice(i, i + 50));
      }
      setSelected(new Set());
      setPendingBulk(false);
      setRestartNeeded(true);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to delete the selected addons.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleToggle = async (addon: InstalledAddon) => {
    if (!canWrite) return;
    markBusy(addon.fileName, true);
    try {
      await apiClient.setMinecraftAddonEnabled(serverId, addon.fileName, !addon.enabled);
      setRestartNeeded(true);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update addon.');
    } finally {
      markBusy(addon.fileName, false);
    }
  };

  const handleUpdate = async (addon: InstalledAddon) => {
    if (!canWrite || !addon.projectId) return;
    markBusy(addon.fileName, true);
    try {
      await apiClient.installMinecraftAddon(serverId, addon.projectId);
      setRestartNeeded(true);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to update addon.');
    } finally {
      markBusy(addon.fileName, false);
    }
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); if (canWrite) setIsDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (canWrite) void handleFiles(Array.from(e.dataTransfer.files));
  };

  if (notSupported) {
    return (
      <div className={`${contentBg} border ${borderColor} rounded-lg p-4 text-sm ${textSecondary}`}>
        Addons are not available for this Minecraft server type.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {restartNeeded && <RestartToApplyNote serverStatus={serverStatus} />}

      {catalogAvailable && context && (
        <div className="order-2">
          <AddonBrowser
            serverId={serverId}
            context={context}
            canWrite={canWrite}
            kindLabel={label}
            onInstalled={() => { setRestartNeeded(true); void load(); }}
            installedByProject={installedByProject}
            borderColor={borderColor}
            contentBg={contentBg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
          />
        </div>
      )}

      {!loading && !error && data && !catalogAvailable && (
        <div className="order-2 flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-600 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>The addon catalog is currently unavailable (Modrinth unreachable). You can still enable, disable, delete and upload files.</span>
        </div>
      )}

      {canWrite && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`order-3 border-2 border-dashed rounded-xl px-6 py-5 flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all duration-150 ${
            isDragging
              ? 'border-[var(--color-cyan-400)] bg-[var(--color-cyan-400)]/8'
              : 'border-gray-300 dark:border-gray-600/60 hover:border-gray-400 dark:hover:border-gray-500'
          }`}
        >
          <Upload className={`w-5 h-5 ${isDragging ? 'text-[var(--color-cyan-400)]' : 'text-gray-500 dark:text-gray-400'}`} />
          <p className={`text-xs ${textSecondary}`}>
            {isDragging ? `Drop ${label.toLowerCase()} here` : 'Drag & drop or click to upload a .jar manually'}
          </p>
          <input
            ref={fileInputRef} type="file" multiple accept=".jar" className="hidden"
            onChange={(e) => { if (e.target.files) void handleFiles(Array.from(e.target.files)); e.target.value = ''; }}
          />
        </div>
      )}

      {uploadQueue.length > 0 && (
        <div className={`order-4 ${contentBg} border ${borderColor} rounded-xl overflow-hidden`}>
          {uploadQueue.map((item) => (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 ${borderColor}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.error ? 'bg-red-500/15' : item.done ? 'bg-emerald-500/15' : 'bg-gray-700/60'}`}>
                {item.error ? <X className="w-4 h-4 text-red-400" /> : item.done ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium truncate ${textPrimary}`}>{item.name}</span>
                  <span className={`text-xs flex-shrink-0 ${item.error ? 'text-red-400' : item.done ? 'text-emerald-400' : 'text-gray-400'}`}>
                    {item.error ? 'Failed' : item.done ? 'Done' : `${item.progress}%`}
                  </span>
                </div>
                {item.error && <p className="text-xs text-red-400 mt-0.5">{item.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`order-1 ${contentBg} border ${borderColor} rounded-xl overflow-hidden`}>
        <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${borderColor}`}>
          <div className="flex items-center gap-2 min-w-0">
            {canWrite && !loading && addons.length > 0 && (
              <input
                type="checkbox"
                aria-label="Select all"
                checked={selected.size === addons.length}
                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < addons.length; }}
                onChange={(e) => setSelected(e.target.checked ? new Set(addons.map((a) => a.fileName)) : new Set())}
                className="w-4 h-4 rounded border-gray-500 accent-[var(--color-cyan-400)] cursor-pointer flex-shrink-0"
              />
            )}
            <h4 className={`text-sm font-semibold ${textPrimary}`}>Installed {label}</h4>
            {!loading && addons.length > 0 && (
              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-700/60 text-gray-300 border border-gray-600/40">{addons.length}</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canWrite && selected.size > 0 && (
              pendingBulk ? (
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs ${textSecondary}`}>Delete {selected.size}?</span>
                  <AppButton tone="ghost" onClick={() => setPendingBulk(false)} className="px-2 py-1 text-xs rounded text-gray-400 hover:text-white">Cancel</AppButton>
                  <AppButton tone="ghost" onClick={() => void handleDeleteMany()} disabled={bulkDeleting}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50">
                    {bulkDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm
                  </AppButton>
                </div>
              ) : (
                <AppButton tone="ghost" onClick={() => setPendingBulk(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded bg-red-500/15 text-red-400 hover:bg-red-500/25">
                  <Trash2 className="w-3.5 h-3.5" /> Delete {selected.size}
                </AppButton>
              )
            )}
            <AppButton tone="ghost" onClick={() => void load()} className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </AppButton>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading {label.toLowerCase()}…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-4 py-4 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        {!loading && !error && addons.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center"><Package className="w-5 h-5 text-gray-500" /></div>
            <div className="text-center">
              <p className={`text-sm font-medium ${textPrimary}`}>No {label.toLowerCase()} installed</p>
              <p className={`text-xs mt-0.5 ${textSecondary}`}>
                {canWrite ? `Browse the catalog or upload a .jar to add your first ${singular}` : `No ${label.toLowerCase()} found`}
              </p>
            </div>
          </div>
        )}

        {!loading && addons.length > 0 && (
          <div>
            {addons.map((addon) => {
              const isBusy = busy.has(addon.fileName);
              const name = addon.title || addon.fileName;
              const showUpdate = addon.updateAvailable && updateCheckAvailable && Boolean(addon.projectId);
              return (
                <div key={addon.fileName} className={`flex items-center gap-3 px-4 py-3 group border-b last:border-b-0 ${borderColor} ${!addon.enabled ? 'opacity-60' : ''} ${selected.has(addon.fileName) ? 'bg-[var(--color-cyan-400)]/5' : ''}`}>
                  {canWrite && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${name}`}
                      checked={selected.has(addon.fileName)}
                      onChange={() => toggleSelect(addon.fileName)}
                      className="w-4 h-4 rounded border-gray-500 accent-[var(--color-cyan-400)] cursor-pointer flex-shrink-0"
                    />
                  )}
                  <div className="w-9 h-9 rounded-lg bg-gray-700/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {addon.iconUrl
                      ? <img src={addon.iconUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <FileCode2 className="w-4 h-4 text-gray-400" />}
                  </div>

                  <div
                    className={`flex-1 min-w-0 ${addon.projectId ? 'cursor-pointer' : ''}`}
                    onClick={() => addon.projectId && setDetailId(addon.projectId)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium truncate ${textPrimary} ${addon.projectId ? 'hover:underline' : ''}`}>{name}</span>
                      {!addon.enabled && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-500/15 text-gray-400 border border-gray-500/30">Disabled</span>
                      )}
                      {addon.compatible === false && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 dark:text-amber-300 border border-amber-500/30">Incompatible</span>
                      )}
                    </div>
                    <p className={`text-xs ${textSecondary}`}>
                      {addon.versionNumber ?? addon.fileName}
                      <> · {formatFileSize(addon.fileSize)}</>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {showUpdate && canWrite && (
                      <AppButton
                        tone="secondary"
                        onClick={() => void handleUpdate(addon)}
                        disabled={isBusy}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg disabled:opacity-50 whitespace-nowrap"
                        title={addon.latestVersionNumber ? `Update to ${addon.latestVersionNumber}` : 'Update'}
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Update
                      </AppButton>
                    )}
                    {canWrite && (
                      <AppToggle
                        ariaLabel={`Toggle ${name}`}
                        checked={addon.enabled}
                        onChange={() => void handleToggle(addon)}
                        disabled={isBusy}
                        className="shrink-0"
                      />
                    )}
                    {canWrite && (
                      pendingDelete === addon.fileName ? (
                        <div className="flex items-center gap-1.5">
                          <AppButton tone="ghost" onClick={() => setPendingDelete(null)} className="px-2 py-1 text-xs rounded text-gray-400 hover:text-white">Cancel</AppButton>
                          <AppButton tone="ghost" onClick={async () => { setPendingDelete(null); await handleDelete(addon.fileName); }} disabled={isBusy}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50">
                            {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Confirm
                          </AppButton>
                        </div>
                      ) : (
                        <AppButton tone="ghost" onClick={() => setPendingDelete(addon.fileName)} disabled={isBusy}
                          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                          title={`Delete ${addon.fileName}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </AppButton>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailId && (
        <MinecraftAddonDetail
          serverId={serverId}
          projectId={detailId}
          canWrite={canWrite}
          installedByProject={installedByProject}
          onInstalled={() => { setRestartNeeded(true); void load(); }}
          onClose={() => setDetailId(null)}
          borderColor={borderColor}
          contentBg={contentBg}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
        />
      )}
    </div>
  );
}
