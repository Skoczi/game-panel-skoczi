import { FileHistoryModal } from './FileHistoryModal';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Copy, Download, FolderOpen, Save, X, FileText, History } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { apiClient } from '../../utils/api';
import type { EditorSession } from './useEditorSession';
import './editor-session.css';
import { MediaPreview } from './MediaPreview';
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

export function EditorSessionView({
  session,
  embedded,
}: {
  session: EditorSession;
  embedded: boolean;
}) {
  const active = session.documents.find((doc) => doc.id === session.activeId);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { setHistoryId(null); }, [session.serverId, active?.id]);
  if (!session.documents.length) return null;
  const saveReason = !session.canWrite ? 'You do not have permission to save files.'
    : !active?.loaded || active.loading ? 'Wait for the file to load.'
    : active.saving ? 'Saving the current version…'
    : active.conflict ? 'Compare and resolve the server version before saving.'
    : active.content === active.saved ? 'No unsaved changes.' : '';
  const tabs = (
    <div className="gp-editor-tabs" role="tablist" aria-label="Open files">
      {session.documents.map((doc) => (
        <div className="gp-editor-tab" data-active={doc.id === session.activeId} key={doc.id}>
          <button
            role="tab"
            aria-selected={doc.id === session.activeId}
            title={`${doc.root}:${doc.path}`}
            onClick={() => session.select(doc.id)}
          >
            <FileText size={15} />
            <span>{doc.name}</span>
            {doc.content !== doc.saved && <span aria-label="Unsaved changes">●</span>}
          </button>
          <button
            aria-label={`Close ${doc.name}`}
            disabled={doc.saving}
            onClick={() => session.close(doc.id)}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
  return (
    <>
      {active && session.serverId && historyId === active.id && <FileHistoryModal key={`${session.serverId}:${active.id}`} serverId={session.serverId} doc={active} canRestore={session.canWrite && !active.saving && !active.conflict} onClose={() => setHistoryId(null)} onRestore={content => { setHistoryId(null); session.stageHistory(active.id, content); }} />}
      {!active && tabs}
      <section
        onKeyDown={(event) => event.stopPropagation()}
        className={`gp-editor-session ${embedded ? 'is-embedded' : 'is-modal'}`}
        style={{ display: active ? undefined : 'none' }}
        aria-label="File editor session"
      >
        {tabs}
        <div className="gp-editor-toolbar">
          <AppButton title="Browse files" onClick={() => session.select(null)}>
            <FolderOpen size={16} />
            Browse files
          </AppButton>
          <span className="gp-editor-path" title={`${active?.root}:${active?.path}`}>
            {active?.path}
          </span>
          {active?.kind === 'text' && <AppButton
            onClick={async () => {
              if (!active) return;
              try {
                await navigator.clipboard.writeText(active.content);
                setCopied(active.id);
              } catch {
                session.update(active.id, { error: 'Unable to copy to clipboard' });
              }
            }}
          >
            <Copy size={16} />
            {copied === active?.id ? 'Copied' : 'Copy'}
          </AppButton>}
          <AppButton
            onClick={async () => {
              if (!active || !session.serverId) return;
              try {
                const url = await apiClient.getServerDownloadUrl(
                  session.serverId,
                  active.path,
                  active.root
                );
                const link = document.createElement('a');
                link.href = url;
                link.download = '';
                link.click();
              } catch {
                session.update(active.id, { error: 'Unable to download file' });
              }
            }}
          >
            <Download size={16} />
            Download
          </AppButton>
          {active?.kind === 'text' && <AppButton aria-label="File history" title="File history" onClick={() => setHistoryId(active.id)}><History size={16} /></AppButton>}
          {active?.kind === 'text' && <AppButton
            disabled={Boolean(saveReason)}
            title={saveReason || 'Save file'}
            aria-describedby={saveReason ? 'editor-save-reason' : undefined}
            onClick={() => active && void session.save(active.id)}
          >
            <Save size={16} />
            {active?.saving ? 'Saving…' : 'Save'}
          </AppButton>}
        </div>
        {active?.kind === 'text' && <p id="editor-save-reason" className="min-h-6 shrink-0 px-3 py-1 text-xs text-gray-500 dark:text-gray-400">{saveReason}</p>}
        <div className="gp-editor-documents">
          {session.documents.map((doc) => (
            <div
              key={doc.id}
              className="gp-editor-document"
              style={{ display: doc.id === active?.id ? undefined : 'none' }}
            >
              {doc.loading ? (
                <p>Loading file…</p>
              ) : doc.loaded && doc.kind !== 'text' ? (
                doc.id === active?.id && session.serverId ? <MediaPreview key={doc.id} doc={doc} serverId={session.serverId} /> : null
              ) : doc.loaded ? (
                <Suspense fallback={<p>Loading editor…</p>}>
                  <CodeEditor
                    filename={doc.name}
                    value={doc.content}
                    onChange={(content) => session.update(doc.id, { content })}
                    onSave={() => void session.save(doc.id)}
                    readOnly={!session.canWrite}
                  />
                </Suspense>
              ) : (
                <AppButton
                  onClick={() =>
                    void session.open(
                      { name: doc.name, type: 'file' },
                      doc.root,
                      doc.path.slice(0, doc.path.lastIndexOf('/')) || '/'
                    )
                  }
                >
                  Retry loading file
                </AppButton>
              )}
              {doc.historyNotice && <p role="note" className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{doc.historyNotice}</p>}
              {doc.draftNotice && <p role="note" className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">{doc.draftNotice}</p>}
              {doc.conflict && <div role="alert" className="gp-editor-error space-y-2">
                <p>The file changed on the server. Your edits are still in the editor above.</p>
                <details><summary>Compare: current server file</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{doc.conflict.content}</pre></details>
                <AppButton onClick={() => session.update(doc.id, { version: doc.conflict!.version, saved: doc.conflict!.content, conflict: undefined, error: undefined })}>Keep my edits for merging</AppButton>
                <p>Merge the changes in the editor, then save. A further server change will be checked again.</p>
              </div>}
              {doc.error && (
                <div role="alert" className="gp-editor-error">
                  {doc.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
