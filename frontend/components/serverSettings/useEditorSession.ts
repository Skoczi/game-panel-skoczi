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
}

export function useEditorSession(
  serverId: number | null | undefined,
  canWrite: boolean,
  isOpen: boolean
) {
  const [documents, setDocuments] = useState<EditorDocument[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const current = useRef(documents);
  current.current = documents;
  const generation = useRef(0);
  const sequence = useRef(0);
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
    setDocuments([]);
    setActiveId(null);
    return () => {
      generation.current++;
    };
  }, [serverId, isOpen]);
  const update = (id: string, patch: Partial<EditorDocument>, instance?: number) => {
    current.current = current.current.map((doc) =>
      doc.id === id && (instance === undefined || doc.instance === instance)
        ? { ...doc, ...patch }
        : doc
    );
    setDocuments(current.current);
  };
  const open = async (file: FileItem, root: string, directory: string) => {
    if (!serverId || file.type !== 'file') return;
    const kind = previewKind(file.name);
    if (kind === 'text' && (file.sizeBytes ?? 0) > MAX_INLINE_EDIT_BYTES) {
      window.alert('This file is too large to edit (over 2 MB). Download it to edit locally.');
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
      const content = decodeEditableText(await apiClient.readServerFileBytes(serverId, path, root));
      if (token === generation.current)
        update(id, { kind: content === null ? 'binary' : 'text', content: content ?? '', saved: content ?? '', loading: false, loaded: true }, instance);
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
    update(id, { saving: true, error: undefined });
    try {
      await apiClient.updateServerFile(serverId, doc.path, content, doc.root);
      if (token === generation.current) update(id, { saved: content, saving: false });
    } catch (error: any) {
      if (token === generation.current)
        update(id, {
          saving: false,
          error: error?.response?.data?.error || error.message || 'Unable to save file',
        });
    }
  };
  const close = (id: string) => {
    const doc = current.current.find((doc) => doc.id === id);
    if (doc?.saving) return;
    if (
      doc &&
      doc.content !== doc.saved &&
      !window.confirm(`Discard unsaved changes in ${doc.name}?`)
    )
      return;
    const remaining = current.current.filter((doc) => doc.id !== id);
    current.current = remaining;
    setDocuments(remaining);
    if (activeId === id) setActiveId(remaining[remaining.length - 1]?.id ?? null);
  };
  const prepareMutation = () => {
    if (current.current.some((doc) => doc.saving)) return false;
    if (
      current.current.some((doc) => doc.content !== doc.saved) &&
      !window.confirm('Discard unsaved editor changes before changing file paths?')
    )
      return false;
    generation.current++;
    current.current = [];
    setDocuments([]);
    setActiveId(null);
    return true;
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
    dirty: documents.some((doc) => doc.content !== doc.saved),
    serverId,
    canWrite,
  };
}

export type EditorSession = ReturnType<typeof useEditorSession>;
