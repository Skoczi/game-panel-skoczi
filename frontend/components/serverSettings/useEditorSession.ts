import { draftEpoch, readEditorDraft, saveEditorDraft, removeEditorDraft, type DraftScope } from '../../utils/editorDrafts';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../utils/api';
import { MAX_INLINE_EDIT_BYTES, type FileItem } from './fileManagerHandlers';
import { joinPath } from './utils';
import { previewKind, decodeEditableText, type PreviewKind } from './filePreview';

export interface EditorDocument {
  id: string;
  root: string;
  path: string;
  name: string;
  kind: PreviewKind;
  content: string;
  saved: string;
  loading: boolean;
  loaded: boolean;
  instance: number;
  saving: boolean;
  error?: string;
  draftNotice?: string;
  historyNotice?: string;
  version?: string;
}

export function useEditorSession(
  serverId: number | null | undefined,
  canWrite: boolean,
  isOpen: boolean,
  requestConfirm: (title: string, message: string, onConfirm: () => Promise<void>) => void,
  draftScope?: DraftScope
) {
  const [documents, setDocuments] = useState<EditorDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const current = useRef(documents);
  current.current = documents;
  const generation = useRef(0);
  const sequence = useRef(0);
  const epoch = useRef(draftEpoch());
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!current.current.some((doc) => doc.content !== doc.saved)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    generation.current++;
    epoch.current = draftEpoch();
    setDocuments([]);
    setActiveId(null);
    return () => {
      generation.current++;
    };
  }, [serverId, isOpen, draftScope?.userId, draftScope?.serverId, draftScope?.nodeId]);
  useEffect(() => {
    const discard = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!draftScope || detail?.nodeId !== draftScope.nodeId || String(serverId) !== detail?.serverId) return;
      for (const doc of current.current) removeEditorDraft(draftScope, doc.root, doc.path);
    };
    window.addEventListener('gp:discard-editor-drafts', discard);
    return () => window.removeEventListener('gp:discard-editor-drafts', discard);
  }, [serverId, draftScope?.userId, draftScope?.serverId, draftScope?.nodeId]);
  const update = (id: string, patch: Partial<EditorDocument>, instance?: number) => {
    current.current = current.current.map((doc) => {
      if (doc.id !== id || (instance !== undefined && doc.instance !== instance)) return doc;
      const next = { ...doc, ...patch };
      if (draftScope && next.loaded && next.kind === 'text' && next.version && ('content' in patch || 'saved' in patch || 'version' in patch)) {
        if (next.content === next.saved) {
          removeEditorDraft(draftScope, next.root, next.path);
          next.draftNotice = undefined;
        } else {
          const stored = saveEditorDraft({ ...draftScope, root: next.root, path: next.path, version: next.version, content: next.content, saved: next.saved, updatedAt: Date.now() }, epoch.current);
          next.draftNotice = stored ? 'Draft saved locally.' : 'Local draft unavailable. Save your work before closing this tab.';
        }
      }
      return next;
    });
    setDocuments(current.current);
  };
  const open = async (file: FileItem, root: string, directory: string) => {
    if (!serverId || file.type !== 'file') return;
    const kind = previewKind(file.name);
    if (kind === 'text' && (file.sizeBytes ?? 0) > MAX_INLINE_EDIT_BYTES) {
      requestConfirm('File too large', 'This file is over 2 MiB. Download it to edit locally.', async () => {});
      return;
    }
    const path = joinPath(directory, file.name);
    const id = JSON.stringify([root, path]);
    setActiveId(id);
    if (current.current.some((doc) => doc.id === id && (doc.loaded || doc.loading))) return;
    const instance = ++sequence.current;
    const doc: EditorDocument = {
      id,
      root,
      path,
      name: file.name,
      kind,
      content: '',
      saved: '',
      loading: true,
      loaded: false,
      instance,
      saving: false,
    };
    current.current = [...current.current.filter((doc) => doc.id !== id), doc];
    setDocuments(current.current);
    const token = generation.current;
    if (kind !== 'text') {
      update(id, { loading: false, loaded: true }, instance);
      return;
    }
    try {
      const snapshot = await apiClient.readServerFileSnapshot(serverId, path, root);
      const content = decodeEditableText(snapshot.bytes);
      if (token === generation.current) {
        const draft = draftScope && content !== null && snapshot.version ? readEditorDraft(draftScope, root, path) : undefined;
        const restore = draft && draft.content !== content;
        update(id, {
          version: restore ? draft.version : snapshot.version,
          kind: content === null ? 'binary' : 'text', content: restore ? draft.content : content ?? '',
          saved: restore ? draft.saved : content ?? '', loading: false, loaded: true,
        }, instance);
      }
    } catch (error: any) {
      if (token === generation.current)
        update(
          id,
          {
            loading: false,
            error: error?.response?.data?.error || error.message || 'Unable to load file',
          },
          instance
        );
    }
  };
  const save = async (id: string) => {
    const doc = current.current.find((doc) => doc.id === id);
    if (
      !serverId ||
      !canWrite ||
      !doc ||
      doc.kind !== 'text' ||
      !doc.loaded ||
      doc.loading ||
      doc.saving ||
      doc.content === doc.saved
    )
      return;
    const token = generation.current;
    const content = doc.content;
    update(id, { saving: true, error: undefined, historyNotice: undefined });
    try {
      const result = await apiClient.updateServerFile(serverId, doc.path, content, doc.root, doc.version, true);
      if (token === generation.current) update(id, { saved: content, saving: false, version: result.version, historyNotice: result.historyWarning });
    } catch (error: any) {
      if (token === generation.current)
        update(id, {
          saving: false,
          error: error?.response?.data?.error || error.message || 'Unable to save file',
        });
    }
  };
  const stageHistory = (id: string, content: string) => {
    const doc = current.current.find(value => value.id === id);
    if (!doc || !canWrite || doc.saving) return;
    const token = generation.current;
    const apply = async () => {
      if (token !== generation.current || !current.current.some(value => value.id === id && value.instance === doc.instance)) return;
      update(id, { content, error: undefined, historyNotice: 'Previous version loaded. Save to apply it.' }, doc.instance);
    };
    if (doc.content !== doc.saved) requestConfirm('Replace current draft?', 'Replace the unsaved editor text with this historical snapshot? The server file is not changed until you save.', apply);
    else void apply();
  };
  const close = (id: string, confirmed = false) => {
    const doc = current.current.find((doc) => doc.id === id);
    if (doc?.saving) return;
    if (doc && doc.content !== doc.saved && !confirmed) {
      requestConfirm('Discard changes', `Discard unsaved changes in ${doc.name}?`, async () => close(id, true));
      return;
    }
    if (doc && draftScope) removeEditorDraft(draftScope, doc.root, doc.path);
    const remaining = current.current.filter((doc) => doc.id !== id);
    current.current = remaining;
    setDocuments(remaining);
    if (activeId === id) setActiveId(remaining[remaining.length - 1]?.id ?? null);
  };
  const prepareMutation = (action: () => void, confirmed = false) => {
    if (current.current.some((doc) => doc.saving)) return;
    if (current.current.some((doc) => doc.content !== doc.saved) && !confirmed) {
      requestConfirm('Discard changes', 'Discard unsaved editor changes before changing file paths?', async () => prepareMutation(action, true));
      return;
    }
    if (draftScope) for (const doc of current.current) removeEditorDraft(draftScope, doc.root, doc.path);
    generation.current++;
    current.current = [];
    setDocuments([]);
    setActiveId(null);
    action();
  };
  return {
    documents,
    activeId,
    select: setActiveId,
    open,
    save,
    close,
    update,
    prepareMutation,
    stageHistory,
    dirty: documents.some((doc) => doc.content !== doc.saved),
    serverId,
    canWrite,
  };
}

export type EditorSession = ReturnType<typeof useEditorSession>;
