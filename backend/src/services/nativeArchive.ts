import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import tar from 'tar-stream';
// Check the same portable tree that restore accepts, without extracting a second copy.
export async function validateNativeArchive(filename: string) {
  const entries = new Map<string, { type: string; target?: string }>();
  const extract = tar.extract();
  extract.on('entry', (header, stream, next) => {
    stream.on('error', (error) => extract.destroy(error));
    try {
      const name = header.name.replace(/\/$/, '');
      const parts = name.split('/');
      if (
        parts[0] !== 'serverfiles' ||
        parts.some((p) => !p || p === '.' || p === '..') ||
        name.includes('\\') ||
        entries.has(name)
      )
        throw new Error('Backup contains an unsupported or duplicate path');
      const type = header.type || '';
      if (!['file', 'directory', 'link', 'symlink'].includes(type))
        throw new Error('Backup contains special files that cannot be restored');
      if (entries.size >= 1_000_000) throw new Error('Backup contains too many entries');
      const target = header.linkname ?? undefined;
      if (type === 'link' || type === 'symlink') {
        if (!target || path.posix.isAbsolute(target) || target.includes('\\'))
          throw new Error('Backup contains an external link and cannot be safely restored');
      }
      entries.set(name, { type, target });
      stream.resume();
      next();
    } catch (error) {
      extract.destroy(error as Error);
    }
  });
  await pipeline(createReadStream(filename), createGunzip(), extract);
  if (entries.get('serverfiles')?.type !== 'directory')
    throw new Error('Backup is missing serverfiles');
  // Resolve components in filesystem order: normalizing first would hide escapes
  // through a symlink followed by "..". Missing internal soft-link targets are valid.
  function resolve(name: string): string {
    const pending = name.split('/');
    const resolved: string[] = [];
    let followed = 0;
    while (pending.length) {
      const part = pending.shift()!;
      if (!part || part === '.') continue;
      if (part === '..') {
        if (resolved.length <= 1) throw new Error('Backup link escapes serverfiles');
        resolved.pop(); continue;
      }
      resolved.push(part);
      if (resolved[0] !== 'serverfiles') throw new Error('Backup link escapes serverfiles');
      const key = resolved.join('/');
      const entry = entries.get(key);
      if (entry?.type === 'symlink' || entry?.type === 'link') {
        if (++followed > 40) throw new Error('Backup contains cyclic links');
        if (entry.type === 'link') resolved.length = 0;
        else resolved.pop();
        pending.unshift(...entry.target!.split('/'));
      } else if (entry && pending.length && entry.type !== 'directory') {
        throw new Error('Backup path crosses a non-directory');
      }
    }
    return resolved.join('/');
  }
  for (const [name, entry] of entries) {
    if (entry.type === 'symlink' || entry.type === 'link') resolve(name);
    if (entry.type === 'link' && entries.get(entry.target!)?.type !== 'file')
      throw new Error('Backup contains an invalid hard link target');
    // Restore never writes children through an archived link.
    for (
      let parent = path.posix.dirname(name);
      parent !== '.';
      parent = path.posix.dirname(parent)
    ) {
      if (entries.get(parent)?.type !== 'directory')
        throw new Error('Backup path crosses a link or missing directory');
    }
  }
}
