import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_INLINE_FILE_SIZE = 2 * 1024 * 1024;
export const fileVersion = (content: Buffer | string) => `"${createHash('sha256').update(content).digest('hex')}"`;
const writes = new Set<string>();
const conflict = () => Object.assign(new Error('File changed since it was opened. Compare the current file before saving.'), { statusCode: 409 });

export async function atomicFileWrite(filename: string, content: string, expected: string, beforeCommit?: (previous: Buffer) => Promise<void>, overwrite = false) {
    if (!overwrite && !expected) throw Object.assign(new Error('Reopen this file before saving: its version is required'), { statusCode: 428 });
    if (Buffer.byteLength(content, 'utf8') > MAX_INLINE_FILE_SIZE) throw Object.assign(new Error('File too large'), { statusCode: 413 });
    if (writes.has(filename)) throw Object.assign(new Error('A save is in progress. Try again.'), { statusCode: 409 });
    writes.add(filename);
    const temporary = path.join(path.dirname(filename), `.gp-${randomUUID()}.tmp`);
    try {
        const stat = await fs.lstat(filename);
        if (!stat.isFile()) throw new Error('Expected a regular file');
        const previous = await fs.readFile(filename);
        if (!overwrite && fileVersion(previous) !== expected) throw conflict();
        await beforeCommit?.(previous);
        const output = await fs.open(temporary, 'wx', stat.mode & 0o777);
        try {
            await output.writeFile(content, 'utf8');
            const owner = await output.stat();
            if (owner.uid !== stat.uid || owner.gid !== stat.gid) await output.chown(stat.uid, stat.gid);
            await output.chmod(stat.mode & 0o777);
            await output.sync();
        } finally { await output.close(); }
        // Recheck after staging. External game processes do not participate in our lock.
        const current = await fs.lstat(filename);
        if (!current.isFile()) throw new Error('Expected a regular file');
        if (!overwrite && (current.ino !== stat.ino || current.dev !== stat.dev || fileVersion(await fs.readFile(filename)) !== expected)) throw conflict();
        await fs.rename(temporary, filename);
        const directory = await fs.open(path.dirname(filename), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
        return fileVersion(content);
    } finally {
        await fs.unlink(temporary).catch(() => {});
        writes.delete(filename);
    }
}
