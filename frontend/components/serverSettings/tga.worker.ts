import { decodeTga } from './tgaDecoder';
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const { width, height, data } = decodeTga(event.data);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preview is unavailable in this browser.');
    context.putImageData(new ImageData(data, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Unable to decode TGA.' });
  }
};
