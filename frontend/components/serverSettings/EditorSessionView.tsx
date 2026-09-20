import { lazy, Suspense, useState } from 'react';
import { Copy, Download, FolderOpen, Save, X, FileText } from 'lucide-react';
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
  const [copied, setCopied] = useState<string | null>(null);
  if (!session.documents.length) return null;
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
          {active?.kind === 'text' && <AppButton
            disabled={
              !active ||
              !session.canWrite ||
              !active.loaded ||
              active.loading ||
              active.saving ||
              active.content === active.saved
            }
            onClick={() => active && void session.save(active.id)}
          >
            <Save size={16} />
            {active?.saving ? 'Saving…' : 'Save'}
          </AppButton>}
        </div>
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
