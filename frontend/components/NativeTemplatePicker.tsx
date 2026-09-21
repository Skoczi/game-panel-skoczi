import { useEffect, useState } from 'react';
import { nodesRequest } from '../utils/nodesApi';
import type { TemplateVersion } from '../utils/gameTemplates';

export function NativeTemplatePicker({ search, canInstall, onSelect }: { search: string; canInstall: boolean; onSelect: (row: TemplateVersion) => void }) {
  const [rows, setRows] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void nodesRequest<{ templates: TemplateVersion[] }>('/api/game-templates').then(value => {
      if (!active) return;
      const latest = new Map<string, TemplateVersion>();
      for (const row of value.templates) {
        if (row.status !== 'published' || row.document.schemaVersion !== 2) continue;
        if (!latest.has(row.id) || latest.get(row.id)!.version < row.version) latest.set(row.id, row);
      }
      setRows([...latest.values()].sort((a, b) => a.document.name.localeCompare(b.document.name)));
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : 'Cannot load templates'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  if (loading) return <p role="status">Loading panel templates…</p>;
  if (error) return <div role="alert" className="space-y-3"><p>{error}</p><button onClick={() => setRetry(v => v + 1)} className="rounded-lg border px-3 py-2">Retry templates</button></div>;
  const filtered = rows.filter(row => `${row.document.name} ${row.document.description || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section aria-label="Panel templates" className="space-y-3 text-gray-900 dark:text-white">
    {!rows.length ? <p>No published native templates. Publish one in Game Templates.</p> : !filtered.length ? <p>No templates match your search.</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {filtered.map(row => <article key={row.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-gray-300 bg-gp-surface-elevated p-4 dark:border-gray-700">
        <div className="min-w-0"><h3 className="break-words font-medium">{row.document.name}</h3><p className="text-xs text-gray-500">v{row.version} · Native</p></div>
        <button className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={!canInstall} onClick={() => onSelect(row)} aria-label={`Install ${row.document.name}`}>Select →</button>
      </article>)}
    </div>}
  </section>;
}
