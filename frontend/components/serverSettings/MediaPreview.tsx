import { useEffect, useState } from 'react';
import { FileQuestion, Music, RotateCcw, ZoomIn } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { AppButton } from '../../src/ui/components';
import type { EditorDocument } from './useEditorSession';
import './media-preview.css';

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
export function MediaPreview({ doc, serverId }: { doc: EditorDocument; serverId: number }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (doc.kind === 'binary') return;
    const controller = new AbortController();
    let objectUrl = '';
    setUrl(''); setError('');
    void (async () => {
      try {
        const download = await apiClient.getServerDownloadUrl(serverId, doc.path, doc.root);
        if (controller.signal.aborted) return;
        const response = await fetch(download, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error('Unable to load preview.');
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_PREVIEW_BYTES) throw new Error('Preview is limited to 32 MB. Download this file instead.');
            chunks.push(part.value);
          }
        } finally { await reader.cancel(); }
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(new Blob(chunks));
        setUrl(objectUrl);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load preview.');
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [serverId, doc.path, doc.root, doc.kind, attempt]);
  if (doc.kind === 'binary') return <div className="gp-media-preview"><FileQuestion size={32} /><h3>No preview available</h3><p>This file cannot be safely edited as text. Use Download to open it locally.</p></div>;
  return <div className="gp-media-preview">
    {error ? <><p role="alert">{error}</p><AppButton onClick={() => setAttempt(value => value + 1)}>Retry preview</AppButton></> : !url ? <p>Loading preview…</p> : doc.kind === 'audio' ? <>
      <Music size={40} /><h3>{doc.name}</h3>
      <audio controls preload="metadata" src={url} aria-label={`Play ${doc.name}`} onError={() => setError('This audio file is damaged or its codec is not supported by your browser.')} />
    </> : <>
      <div className="gp-media-tools"><AppButton onClick={() => setZoom(value => !value)}>{zoom ? <RotateCcw size={16} /> : <ZoomIn size={16} />}{zoom ? 'Fit image' : 'Original size'}</AppButton></div>
      <div className={`gp-image-canvas ${zoom ? 'is-original' : ''}`}><img src={url} alt={doc.name} onError={() => setError('Unable to display this image. Download it to open locally.')} /></div>
    </>}
  </div>;
}
