import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicFileWrite, fileVersion, MAX_INLINE_FILE_SIZE } from '../src/services/atomicFile.js';
test('conditional atomic writes reject stale content, preserve modes and clean temporary files', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-file-'));
 try {
  const filename = path.join(root, 'server.cfg');
  await fs.writeFile(filename, 'old', { mode: 0o640 });
  const version = fileVersion('old');
  const result = await atomicFileWrite(filename, 'new', version);
  assert.equal(result, fileVersion('new'));
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o640);
  await assert.rejects(atomicFileWrite(filename, 'stale', version), /File changed/);
  await assert.rejects(atomicFileWrite(filename, 'missing', ''), /version is required/);
  await assert.rejects(atomicFileWrite(filename, 'ą'.repeat(MAX_INLINE_FILE_SIZE), result), /too large/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(root), ['server.cfg']);
  const writes = await Promise.allSettled([atomicFileWrite(filename, 'a', result), atomicFileWrite(filename, 'b', result)]);
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1);
 } finally { await fs.rm(root, { recursive: true, force: true }); }
});
