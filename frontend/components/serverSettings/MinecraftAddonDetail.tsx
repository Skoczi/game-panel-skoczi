import { AppOptionSelect } from '../../src/ui/components/AppOptionSelect';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, ExternalLink, Loader2, Package, X,
} from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import { Markdown } from '../Markdown';
import type { AddonDependency, AddonProject } from '../../utils/minecraftAddons';

interface MinecraftAddonDetailProps {
  serverId: number;
  projectId: string;
  anyVersion?: boolean;
  canWrite: boolean;
  installedByProject?: Map<string, string | null>;
  onInstalled: () => void;
  onClose: () => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// A mod version can list dozens of supported game versions; <option> text can't be
// truncated in CSS, so cap it here or the native dropdown overflows the modal.
function summarizeGameVersions(gv: string[], max = 4): string {
  if (gv.length <= max) return gv.join(', ');
  return `${gv.slice(0, max).join(', ')} +${gv.length - max}`;
}

function depTypeClass(t: AddonDependency['type']): string {
  if (t === 'required' || t === 'incompatible') return 'bg-red-500/15 text-red-400 border-red-500/30';
  return 'bg-gray-500/15 text-gray-400 border-gray-500/30';
}

export function MinecraftAddonDetail({
  serverId, projectId, anyVersion = false, canWrite, installedByProject,
  onInstalled, onClose, borderColor, contentBg, textPrimary, textSecondary,
}: MinecraftAddonDetailProps) {
  const [currentId, setCurrentId] = useState(projectId);
  const [history, setHistory] = useState<string[]>([]);
  const [project, setProject] = useState<AddonProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installingDep, setInstallingDep] = useState<Set<string>>(new Set());
  const [installedNow, setInstalledNow] = useState<string | null>(null);
  const [installedDeps, setInstalledDeps] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedVersionId('');
    try {
      const { project: p } = await apiClient.getMinecraftAddonProject(serverId, currentId, anyVersion);
      setProject(p);
      const stable = p.versions.find((v) => v.versionType === 'release') ?? p.versions[0] ?? null;
      setSelectedVersionId(stable?.versionId ?? '');
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        status === 404 ? 'This addon no longer exists on Modrinth.'
        : status === 502 ? 'Modrinth is unreachable. Please try again later.'
        : err?.response?.data?.error || err?.message || 'Failed to load addon.'
      );
    } finally {
      setLoading(false);
    }
  }, [serverId, currentId, anyVersion]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { setInstalledNow(null); setInstalledDeps(new Set()); }, [currentId]);

  const openDependency = (depId: string) => {
    setHistory((h) => [...h, currentId]);
    setCurrentId(depId);
  };
  const goBack = () => {
    setHistory((h) => {
      const next = [...h];
      const prev = next.pop();
      if (prev) setCurrentId(prev);
      return next;
    });
  };

  const install = async (versionId?: string) => {
    if (!project || installing) return;
    setInstalling(true);
    try {
      await apiClient.installMinecraftAddon(serverId, project.projectId, versionId);
      const stable = project.versions.find((v) => v.versionType === 'release') ?? project.versions[0] ?? null;
      setInstalledNow(versionId ?? stable?.versionId ?? '');
      onInstalled();
      await load();
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        status === 409 ? `Not available for this loader and Minecraft version.`
        : err?.response?.data?.error || err?.message || 'Install failed.'
      );
    } finally {
      setInstalling(false);
    }
  };

  const installDependency = async (dep: AddonDependency) => {
    if (!dep.projectId || installingDep.has(dep.projectId)) return;
    setInstallingDep((prev) => new Set([...prev, dep.projectId!]));
    try {
      await apiClient.installMinecraftAddon(serverId, dep.projectId);
      setInstalledDeps((prev) => new Set([...prev, dep.projectId!]));
      onInstalled();
      await load();
    } catch {
      /* transient — retryable */
    } finally {
      setInstallingDep((prev) => { const s = new Set(prev); s.delete(dep.projectId!); return s; });
    }
  };

  const versions = project?.versions ?? [];
  const latestStable = versions.find((v) => v.versionType === 'release') ?? versions[0] ?? null;
  const selected = versions.find((v) => v.versionId === selectedVersionId) ?? null;
  const targetVersionId = selected?.versionId ?? latestStable?.versionId ?? null;
  const mapInstalled = installedByProject?.has(currentId) ?? false;
  const mapVersionId = installedByProject?.get(currentId) ?? null;
  const effInstalledVer = installedNow ?? project?.installedVersionId ?? mapVersionId;
  const effInstalled = installedNow !== null || Boolean(project?.installed) || mapInstalled;
  const alreadyInstalled = effInstalled && effInstalledVer === targetVersionId;
  const isUpdate = effInstalled && !alreadyInstalled;
  const noBuild = project ? project.compatibleVersionCount === 0 : false;

  const selectCls = `w-full rounded-lg bg-white dark:bg-[#0f1723]/60 border ${borderColor} ${textPrimary} text-sm px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 appearance-none cursor-pointer`;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
      <div className={`flex w-full h-full md:w-[90vw] md:h-[85vh] md:max-w-6xl flex-col rounded-none md:rounded-lg border ${borderColor} ${contentBg} shadow-2xl overflow-hidden`}>
        <div className={`flex items-center gap-3 border-b ${borderColor} px-4 py-3`}>
          {history.length > 0 && (
            <AppButton
              tone="ghost"
              onClick={goBack}
              aria-label="Back"
              className={`rounded p-1.5 ${textSecondary} hover:text-white`}
            >
              <ArrowLeft className="w-4 h-4" />
            </AppButton>
          )}
          <div className="w-8 h-8 rounded-lg bg-gray-700/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {project?.iconUrl ? <img src={project.iconUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-gray-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`text-base font-semibold truncate ${textPrimary}`}>{project?.title ?? 'Addon'}</h3>
            {project && <p className={`text-xs ${textSecondary} truncate`}>by {project.author}</p>}
          </div>
          <AppButton tone="ghost" onClick={onClose} aria-label="Close" className={`rounded p-1.5 ${textSecondary} hover:text-red-400`}>
            <X className="w-5 h-5" />
          </AppButton>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 py-10 justify-center text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
          {!loading && error && (
            <div className="flex items-start gap-2 px-4 py-6 text-sm text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          {!loading && !error && project && (
            <div className="p-4 space-y-4 max-w-4xl mx-auto">
              <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${textSecondary}`}>
                <span>↓ {formatCount(project.downloads)} downloads</span>
                <span>♥ {formatCount(project.follows)} followers</span>
                {project.license && <span>{project.license}</span>}
                {project.categories.slice(0, 4).map((c) => (
                  <span key={c} className="px-1.5 py-0.5 rounded-full bg-gray-700/40 border border-gray-600/40">{c}</span>
                ))}
              </div>

              {project.gallery.length > 0 && (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {project.gallery.map((img) => (
                    <div key={img.url} className="flex-shrink-0 w-64">
                      <img src={img.url} alt={img.title ?? ''} className={`w-64 h-36 object-cover rounded-lg border ${borderColor}`} loading="lazy" />
                      {img.title && <p className={`text-[11px] mt-1 truncate ${textSecondary}`}>{img.title}</p>}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <label className={`block text-sm font-semibold ${textPrimary}`}>Version</label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    {noBuild ? (
                      <p className="text-xs text-amber-600 dark:text-amber-300">No build for this loader and Minecraft version.</p>
                    ) : (
                      <div className="relative">
                        <AppOptionSelect className={selectCls} value={selectedVersionId || latestStable?.versionId || ''} onChange={(selectedValue) => setSelectedVersionId(selectedValue)} disabled={!canWrite}>
                          {versions.map((v) => (
                            <option key={v.versionId} value={v.versionId}>
                              {v.versionNumber}{v.versionType !== 'release' ? ` — ${v.versionType}` : ''} · {summarizeGameVersions(v.gameVersions)}{v.versionId === latestStable?.versionId ? ' (Latest release)' : ''}
                            </option>
                          ))}
                        </AppOptionSelect>
                      </div>
                    )}
                  </div>
                  {canWrite && (
                    <AppButton
                      tone={alreadyInstalled ? 'ghost' : 'primary'}
                      onClick={() => void install(selectedVersionId || undefined)}
                      disabled={installing || noBuild || alreadyInstalled}
                      className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                    >
                      {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : alreadyInstalled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                      {alreadyInstalled ? 'Installed' : isUpdate ? 'Update' : 'Install'}
                    </AppButton>
                  )}
                </div>
                {project.compatibleVersionCount > versions.length && (
                  <p className={`text-[11px] ${textSecondary}`}>Showing the latest {versions.length} of {project.compatibleVersionCount} compatible versions.</p>
                )}
              </div>

              {project.dependencies.length > 0 && (
                <div className="space-y-2">
                  <h4 className={`text-sm font-semibold ${textPrimary}`}>Dependencies declared by the author</h4>
                  {project.dependencies.map((dep, i) => {
                    const depInstalled = Boolean(dep.projectId)
                      && (installedDeps.has(dep.projectId!) || (installedByProject?.has(dep.projectId!) ?? false));
                    const depInstalling = Boolean(dep.projectId) && installingDep.has(dep.projectId!);
                    return (
                    <div key={`${dep.projectId ?? dep.slug ?? i}`} className={`flex items-center gap-3 rounded-lg border ${borderColor} p-2.5`}>
                      <div className="w-8 h-8 rounded-lg bg-gray-700/40 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {dep.iconUrl ? <img src={dep.iconUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm ${textPrimary} truncate`}>{dep.title ?? dep.slug ?? 'Unknown'}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${depTypeClass(dep.type)}`}>{dep.type}</span>
                        </div>
                        {dep.type === 'required' && !depInstalled && (
                          <p className={`text-[11px] ${textSecondary}`}>Required for this mod to work.</p>
                        )}
                      </div>
                      {dep.projectId && dep.type !== 'incompatible' && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <AppButton tone="ghost" onClick={() => openDependency(dep.projectId!)} className="px-2 py-1 text-xs rounded">Details</AppButton>
                          {canWrite && (
                            <AppButton
                              tone={depInstalled ? 'ghost' : 'secondary'}
                              onClick={() => void installDependency(dep)}
                              disabled={depInstalling || depInstalled}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg disabled:opacity-50"
                            >
                              {depInstalling
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : depInstalled
                                  ? <CheckCircle2 className="w-3 h-3" />
                                  : <Download className="w-3 h-3" />}
                              {depInstalled ? 'Installed' : 'Install'}
                            </AppButton>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              {(project.links.source || project.links.issues || project.links.wiki || project.links.discord) && (
                <div className="flex flex-wrap gap-3 text-xs">
                  {([['source', 'Source'], ['issues', 'Issues'], ['wiki', 'Wiki'], ['discord', 'Discord']] as const).map(([key, lbl]) => {
                    const url = project.links[key];
                    if (!url) return null;
                    return (
                      <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-cyan-400)] hover:underline">
                        {lbl} <ExternalLink className="w-3 h-3" />
                      </a>
                    );
                  })}
                </div>
              )}

              {project.body && (
                <div className={`rounded-lg border ${borderColor} p-4`}>
                  <Markdown allowSanitizedHtml>{project.body}</Markdown>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
