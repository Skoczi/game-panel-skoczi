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
  function resolve(name: string, visited = new Set<string>()): string {
    const normal = path.posix.normalize(name);
    if (normal !== 'serverfiles' && !normal.startsWith('serverfiles/'))
      throw new Error('Backup link escapes serverfiles');
    const parts = normal.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('/');
      const entry = entries.get(key);
      if (!entry) throw new Error('Backup contains a broken link or missing directory');
      if (entry.type === 'link' || entry.type === 'symlink') {
        if (visited.has(key) || visited.size > 40) throw new Error('Backup contains cyclic links');
        const seen = new Set(visited);
        seen.add(key);
        const target =
          entry.type === 'link'
            ? entry.target!
            : path.posix.join(path.posix.dirname(key), entry.target!);
        return resolve(path.posix.join(target, ...parts.slice(i)), seen);
      }
      if (i < parts.length && entry.type !== 'directory')
        throw new Error('Backup path crosses a non-directory');
    }
    return normal;
  }
  for (const [name, entry] of entries) {
    if (entry.type === 'symlink' || entry.type === 'link') resolve(name);
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
