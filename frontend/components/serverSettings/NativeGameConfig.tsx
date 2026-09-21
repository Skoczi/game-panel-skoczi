import { useEffect, useState } from 'react';
import { apiClient } from '../../utils/api';
import { GameConfigAdvancedLinks } from './GameConfigAdvancedLinks';
import type { GameTemplate } from '../../utils/gameTemplates';

// Discover links from this server's actual files, not a LinuxGSM catalog path.
export function NativeGameConfig({ serverId, metadata, onOpen }: {
  serverId?: number | null; metadata?: string | null; onOpen: (path: string, root: string) => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  let template: GameTemplate | undefined;
  try { template = JSON.parse(metadata || '{}')?.template?.document; } catch { /* no snapshot */ }
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setFiles([]);
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
  }, [serverId, metadata]);
  return <div className="gp-server-tab-body p-6 space-y-5 text-gray-800 dark:text-gray-200">
    <header className="gp-server-tab-header"><h3 className="gp-section-title">Game Config</h3></header>
    {template?.configFiles !== undefined ? template.configFiles.map(file => <section key={`${file.root}:${file.path}`}>
      <h4 className="text-sm font-medium mb-2">{file.label}</h4>
      <GameConfigAdvancedLinks configFiles={[file.path]} isLoading={false} canReadFileManager canWriteFileManager={false}
        onOpenFileManagerPath={path => onOpen(path, file.root)} />
    </section>) : <GameConfigAdvancedLinks configFiles={files} isLoading={loading} error={error || null}
      canReadFileManager canWriteFileManager={false} onOpenFileManagerPath={path => onOpen(path, 'data')} />}
    {!loading && !error && !files.length && !template?.configFiles?.length && <p>No configuration files found. Use File Manager for deeper directories.</p>}
  </div>;
}
