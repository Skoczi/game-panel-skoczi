import { lazy, Suspense, useEffect, useState } from 'react';
import { AppButton, AppModal, AppModalBody, AppModalContent, AppModalHeader, AppModalTitle } from '../../src/ui/components';
import { apiClient, type FileHistoryDetail, type FileHistoryEntry } from '../../utils/api';
import { apiErrorMessage } from '../../utils/apiError';
import type { EditorDocument } from './useEditorSession';
const Diff = lazy(() => import('./CodeEditor').then(module => ({ default: module.ReadOnlyDiff })));
export function FileHistoryModal({ serverId, doc, canRestore, onClose, onRestore }: {
  serverId: number; doc: EditorDocument; canRestore: boolean; onClose: () => void; onRestore: (content: string) => void;
}) {
  const [entries, setEntries] = useState<FileHistoryEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<FileHistoryDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setEntries([]); setSelected(''); setDetail(null);
    void apiClient.fileHistory(serverId, doc.path, doc.root).then(result => { if (active) setEntries(result); })
      .catch(cause => { if (active) setError(cause?.response?.status === 404 ? 'File history is unavailable. Check this node’s agent version.' : apiErrorMessage(cause, 'Unable to load file history.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [serverId, doc.path, doc.root, revision]);
  useEffect(() => {
    let active = true; setDetail(null);
    if (!selected) return;
    setError('');
    void apiClient.fileHistoryEntry(serverId, doc.path, doc.root, selected).then(result => { if (active) setDetail(result); })
      .catch(cause => { if (active) setError(apiErrorMessage(cause, 'Unable to read snapshot.')); });
    return () => { active = false; };
  }, [selected, serverId, doc.path, doc.root]);
  return <AppModal open onOpenChange={open => { if (!open) onClose(); }}><AppModalContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-y-auto"><AppModalBody>
    <AppModalHeader><AppModalTitle>File history · {doc.name}</AppModalTitle></AppModalHeader>
    <div className="space-y-3 text-sm">
      <p className="text-gray-500 dark:text-gray-400">Editor saves only. Up to 10 snapshots per file, 100 per server, retained for 30 days. Text snapshots up to 512 KiB; 64 MiB per server. This history is not a backup.</p>
      <AppButton disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh file history</AppButton>
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {!loading && !error && entries.length === 0 && <p>No recorded editor saves for this file.</p>}
      {!loading && <div className="flex flex-wrap gap-2">{entries.map(entry => <AppButton key={entry.id} aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>
        {new Date(entry.createdAt).toLocaleString()} · {entry.actor} · {entry.state === 'committed' ? 'Saved' : 'Save not confirmed'}
      </AppButton>)}</div>}
      {detail && <>
        <p>Before this save → {detail.state === 'committed' ? 'after this save' : 'proposed text (save not confirmed)'}</p>
        <Suspense fallback={<p>Loading comparison…</p>}><Diff before={detail.before} after={detail.after} filename={doc.name} /></Suspense>
        <p>The previous version will be loaded into your editor. Saving still checks for newer server changes.</p>
        <AppButton tone="primary" disabled={!canRestore} onClick={() => onRestore(detail.before)}>Use previous version in editor</AppButton>
        {!canRestore && <p>Write permission and a resolved, idle editor are required.</p>}
      </>}
    </div>
  </AppModalBody></AppModalContent></AppModal>;
}
