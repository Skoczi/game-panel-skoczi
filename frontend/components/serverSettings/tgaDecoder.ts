// TGA header layout: https://formats.kaitai.io/tga/
// Deliberately reject legacy interleaved images rather than show incorrect pixels.
export function decodeTga(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 18 || bytes.length > 32 * 1024 * 1024) throw new Error('Invalid TGA file size.');
  const view = new DataView(buffer);
  const type = bytes[2], depth = bytes[16], descriptor = bytes[17];
  const width = view.getUint16(12, true), height = view.getUint16(14, true);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024)
    throw new Error('TGA preview is limited to 16 megapixels and 8192 pixels per side.');
  const mapped = type === 1 || type === 9;
  const gray = type === 3 || type === 11;
  const rle = type >= 9;
  if (![1, 2, 3, 9, 10, 11].includes(type) || descriptor & 192 || bytes[1] > 1 ||
      (mapped && bytes[1] !== 1) ||
      !(mapped ? [8, 16] : gray ? [8, 16] : [16, 24, 32]).includes(depth))
    throw new Error('This TGA variant is not supported. Download it to open locally.');
  let offset = 18 + bytes[0];
  const requireBytes = (count: number) => { if (offset + count > bytes.length) throw new Error('Truncated TGA image.'); };
  requireBytes(0);
  const color = (bits: number, alpha: boolean): number[] => {
    requireBytes(Math.ceil(bits / 8));
    if (bits === 15 || bits === 16) {
      const v = bytes[offset++] | bytes[offset++] << 8;
      return [Math.round(((v >> 10) & 31) * 255 / 31), Math.round(((v >> 5) & 31) * 255 / 31), Math.round((v & 31) * 255 / 31), alpha ? (v & 32768 ? 255 : 0) : 255];
    }
    const b = bytes[offset++], g = bytes[offset++], r = bytes[offset++];
    const a = bits === 32 ? bytes[offset++] : 255;
    return [r, g, b, alpha ? a : 255];
  };
  const first = view.getUint16(3, true), count = view.getUint16(5, true), paletteDepth = bytes[7];
  const palette: number[][] = [];
  if (bytes[1]) {
    if (![15, 16, 24, 32].includes(paletteDepth) || first + count > 65536) throw new Error('Invalid TGA palette.');
    for (let i = 0; i < count; i++) palette.push(color(paletteDepth, (descriptor & 15) !== 0));
  }
  const readPixel = () => {
    if (mapped) {
      requireBytes(depth / 8);
      let index = bytes[offset++];
      if (depth === 16) index |= bytes[offset++] << 8;
      const pixel = palette[index - first];
      if (!pixel) throw new Error('Invalid TGA palette index.');
      return pixel;
    }
    if (gray) {
      requireBytes(depth / 8);
      const v = bytes[offset++], a = depth === 16 ? bytes[offset++] : 255;
      return [v, v, v, (descriptor & 15) ? a : 255];
    }
    return color(depth, (descriptor & 15) !== 0);
  };
  const data = new Uint8ClampedArray(width * height * 4);
  let written = 0;
  const put = (pixel: number[]) => {
    const x = written % width, y = Math.floor(written / width);
    const target = (((descriptor & 32) ? y : height - 1 - y) * width + ((descriptor & 16) ? width - 1 - x : x)) * 4;
    data.set(pixel, target); written++;
  };
  while (written < width * height) {
    let packet = 0;
    if (rle) { requireBytes(1); packet = bytes[offset++]; }
    const run = rle ? (packet & 127) + 1 : 1;
    if (written + run > width * height) throw new Error('Invalid TGA run length.');
    if (packet & 128) { const pixel = readPixel(); for (let i = 0; i < run; i++) put(pixel); }
    else for (let i = 0; i < run; i++) put(readPixel());
  }
  return { width, height, data };
}
