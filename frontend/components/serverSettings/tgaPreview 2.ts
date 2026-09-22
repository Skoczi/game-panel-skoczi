export function renderTga(buffer: ArrayBuffer, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const worker = new Worker(new URL('./tga.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('TGA preview timed out. Download this file instead.')); }, 15000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      cleanup();
      if (event.data.blob instanceof Blob) resolve(event.data.blob);
      else reject(new Error(event.data.error || 'Unable to decode TGA.'));
    };
    worker.onerror = () => { cleanup(); reject(new Error('Unable to decode TGA in this browser.')); };
    worker.postMessage(buffer, [buffer]);
  });
}
