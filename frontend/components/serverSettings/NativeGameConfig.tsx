import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/api';
import { FileText, FolderOpen, ArrowUpRight, RefreshCw } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import './game-config-files.css';
import { NativeConfigEditor } from './NativeConfigEditor';
import { cs16GameConfig } from '../../../backend/src/templates/gameConfig';
import type { GameTemplate } from '../../utils/gameTemplates';

// Discover links from this server's actual files, not a LinuxGSM catalog path.
export function NativeGameConfig({ serverId, metadata, onOpen, canRead = true, canWrite = false, onDirtyChange }: {
  canRead?: boolean; canWrite?: boolean; onDirtyChange?: (dirty: boolean) => void;
  serverId?: number | null; metadata?: string | null; onOpen: (path: string, root: string) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  let templateJson = '';
  try { templateJson = JSON.stringify(JSON.parse(metadata || '{}')?.template?.document) || ''; } catch { /* unavailable snapshot */ }
  const template = useMemo<GameTemplate | undefined>(() => templateJson ? JSON.parse(templateJson) : undefined, [templateJson]);
  const definition = useMemo(() => {
    if (template?.gameConfig === false) return undefined;
    if (template?.gameConfig) return template.gameConfig;
    // Compatibility for installed, immutable CS 1.6 snapshots. Other games need a template definition.
    const file = template?.configFiles?.find(f => /\/cstrike\/server\.cfg$/i.test(f.path));
    return file && /ReHLDS|Counter.Strike\s*1\.6/i.test(template?.name || '') ? cs16GameConfig(file.path, file.root) : undefined;
  }, [template]);
  const [section, setSection] = useState('settings');
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setFiles([]);
    if (!canRead) { setLoading(false); return; }
    if (template?.configFiles !== undefined) { setLoading(false); return; }
    if (!serverId) { setLoading(false); return; }
    void (async () => {
      const found: string[] = [];
      const root = await apiClient.listServerFiles(serverId, '/', 'data');
      const collect = (entries: typeof root.entries, base: string) => {
        for (const e of entries) if (e.type === 'file' && /\.(cfg|ini|properties|json|ya?ml|toml)$/i.test(e.name)) found.push(`${base}/${e.name}`);
      };
      collect(root.entries, '');
      // Bounded discovery supports both old flat installs and serverfiles/<game>.
      const dirs = root.entries.filter(e => e.type === 'dir' && !e.name.startsWith('.')).map(e => ({ path: `/${e.name}`, depth: 1 }));
      for (let index = 0; index < Math.min(dirs.length, 32); index++) {
        if (cancelled) return;
        const dir = dirs[index];
        const result = await apiClient.listServerFiles(serverId, dir.path, 'data');
        collect(result.entries, dir.path);
        if (dir.depth < 2) dirs.push(...result.entries.filter(e => e.type === 'dir' && !e.name.startsWith('.')).map(e => ({ path: `${dir.path}/${e.name}`, depth: dir.depth + 1 })));
      }
      if (!cancelled) setFiles(found.sort());
    })().catch(() => { if (!cancelled) setError('Could not list configuration files. Open File Manager to inspect them.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverId, metadata, canRead]);
  const configFiles = template?.configFiles ?? files.map(path => ({
    path, root: 'data', label: path.split('/').pop() || path,
  }));
  if (!canRead) return <p>File read permission is required to view Game Config.</p>;
  return <div className="gp-server-tab-body gp-config-files text-gray-800 dark:text-gray-200">
    <header className="gp-server-tab-header">
      <h3 className="gp-section-title">Game Config</h3>
      {!loading && !error && <span className="gp-config-file-count">{configFiles.length} {configFiles.length === 1 ? 'file' : 'files'}</span>}
    </header>
    {definition && template && serverId && <>
      <nav className="gp-config-tabs" aria-label="Game Config sections">
        <button type="button" aria-pressed={section === 'settings'} onClick={() => setSection('settings')}>Settings</button>
        <button type="button" aria-pressed={section === 'files'} onClick={() => setSection('files')}>Configuration files <span>{configFiles.length}</span></button>
      </nav>
      <div hidden={section !== 'settings'}><NativeConfigEditor key={`${serverId}:${templateJson}`} serverId={serverId} definition={definition} template={template} active={section === 'settings'} canWrite={canWrite} onOpen={onOpen} onDirtyChange={onDirtyChange} /></div>
    </>}
    <div hidden={Boolean(definition) && section !== 'files'}>
    {loading && <div className="gp-config-file-state" role="status"><RefreshCw size={18} className="animate-spin" />Loading configuration files…</div>}
    {error && <div className="gp-config-file-state is-error" role="alert">{error}</div>}
    {!loading && !error && configFiles.length > 0 && <div className="gp-config-file-grid">
      {configFiles.map(file => {
        const filename = file.path.split('/').pop() || file.path;
        const directory = file.path.slice(0, file.path.lastIndexOf('/') + 1) || '/';
        const extension = filename.includes('.') ? filename.split('.').pop()?.toUpperCase() : 'FILE';
        return <section className="gp-config-file-card" key={`${file.root}:${file.path}`}>
          <div className="gp-config-file-card-head">
            <span className="gp-config-file-icon" aria-hidden="true"><FileText size={21} /></span>
            <h4>{file.label}</h4>
            <span className="gp-config-file-format">{extension}</span>
          </div>
          <div className="gp-config-file-location">
            <code className="gp-config-filename">{filename}</code>
            <span className="gp-config-directory"><FolderOpen size={13} aria-hidden="true" /><code>{directory}</code></span>
          </div>
          <div className="gp-config-file-footer">
            <AppButton tone="ghost" className="gp-config-file-open" onClick={() => onOpen(file.path, file.root)} aria-label={`Open ${file.label} in File Manager`}>
              Open in File Manager <ArrowUpRight size={16} aria-hidden="true" />
            </AppButton>
          </div>
        </section>;
      })}
    </div>}
    {!loading && !error && configFiles.length === 0 && <div className="gp-config-file-state"><FileText size={20} aria-hidden="true" />No configuration files found. Use File Manager for deeper directories.</div>}
    </div>
  </div>;
}
