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
  return <AppModal open onOpenChange={open => { if (!open) onClose(); }}><AppModalContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-y-auto p-5">
    <AppModalHeader><AppModalTitle>File history · {doc.name}</AppModalTitle></AppModalHeader><AppModalBody className="pt-4">
    <div className="space-y-3 text-sm">
      <p className="text-gray-500 dark:text-gray-400">Previous versions from editor saves · 30 days.</p>
      <AppButton disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh file history</AppButton>
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {!loading && !error && entries.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 px-5 py-8 text-center"><p className="font-medium">No saved versions yet.</p><p className="mt-1 text-slate-500 dark:text-slate-400">Save a file to start its history.</p></div>}
      {!loading && <div className="flex flex-col gap-2">{entries.map(entry => <AppButton className="justify-start text-left" key={entry.id} aria-pressed={selected === entry.id} onClick={() => setSelected(entry.id)}>
        {new Date(entry.createdAt).toLocaleString()} · {entry.actor} · {entry.state === 'committed' ? 'Saved' : 'Save not confirmed'}
      </AppButton>)}</div>}
      {detail && <>
        <p>Before this save → {detail.state === 'committed' ? 'after this save' : 'proposed text (save not confirmed)'}</p>
        <Suspense fallback={<p>Loading comparison…</p>}><Diff before={detail.before} after={detail.after} filename={doc.name} /></Suspense>
        <p>Load a previous version, then save to apply it.</p>
        <AppButton tone="primary" disabled={!canRestore} onClick={() => onRestore(detail.before)}>Use previous version in editor</AppButton>
        {!canRestore && <p>Saving is unavailable in this editor.</p>}
      </>}
    </div>
  </AppModalBody></AppModalContent></AppModal>;
}
