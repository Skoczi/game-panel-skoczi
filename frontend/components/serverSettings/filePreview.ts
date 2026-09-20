export type PreviewKind = 'text' | 'image' | 'audio' | 'binary';
export function previewKind(name: string): PreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tga'].includes(ext)) return 'image';
  if (['wav', 'mp3', 'ogg'].includes(ext)) return 'audio';
  if (['zip', 'gz', 'tar', '7z', 'rar', 'exe', 'dll', 'so', 'bin', 'pdf', 'bsp', 'mdl', 'wad', 'pak'].includes(ext)) return 'binary';
  return 'text';
}
export function decodeEditableText(bytes: ArrayBuffer): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\x00-\x08\x0e-\x1f]/.test(text) ? null : text;
  } catch { return null; }
}
