import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareFileHistory, commitFileHistory, listFileHistory, readFileHistory } from '../src/services/fileHistory.js';
import { atomicFileWrite, fileVersion } from '../src/services/atomicFile.js';
const scope = { root: 'data', path: '/serverfiles/server.cfg' };
test('history records actor, exact before/after text and distinguishes prepared from confirmed saves', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-history-'));
  try {
    const file = path.join(root, 'server.cfg'); const dir = path.join(root, '.file-history');
    const original = '\uFEFFhostname old\r\n'; await fs.writeFile(file, original); let pending: any;
    const version = await atomicFileWrite(file, 'hostname new', fileVersion(original), async before => { pending = await prepareFileHistory(dir, scope, 'operator', before, 'hostname new'); });
    assert.equal((await listFileHistory(dir, scope))[0].state, 'prepared');
    await commitFileHistory(dir, pending);
    const entries = await listFileHistory(dir, scope); assert.equal(entries.length, 1); assert.equal(entries[0].actor, 'operator'); assert.equal(entries[0].state, 'committed');
    assert.equal('before' in entries[0], false);
    const record = await readFileHistory(dir, scope, pending.id); assert.equal(record.before, original); assert.equal(record.after, 'hostname new');
    assert.equal((await fs.stat(path.join(dir, pending.id))).mode & 0o777, 0o600);
    // Restoring an old snapshot uses the ordinary conditional write and cannot overwrite a newer edit.
    await fs.writeFile(file, 'external edit');
    await assert.rejects(atomicFileWrite(file, record.before, version), /File changed/);
    assert.equal(await fs.readFile(file, 'utf8'), 'external edit');
    await assert.rejects(readFileHistory(dir, { ...scope, path: '/other.cfg' }, pending.id), /not found/);
    await assert.rejects(readFileHistory(dir, scope, '../outside'), /not found/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('snapshot limits, per-file retention and failed saves preserve the current file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-history-limit-'));
  try {
    const dir = path.join(root, '.file-history');
    for (let index = 0; index < 12; index++) {
      const entry = await prepareFileHistory(dir, scope, 'operator', Buffer.from(`before ${index}`), `after ${index}`); await commitFileHistory(dir, entry);
    }
    assert.equal((await listFileHistory(dir, scope)).length, 10); assert.equal((await fs.readdir(dir)).length, 10);
    await assert.rejects(prepareFileHistory(dir, scope, 'operator', Buffer.alloc(512 * 1024 + 1), 'next'), /512 KiB/);
    await assert.rejects(prepareFileHistory(dir, scope, 'operator', Buffer.from([0xff]), 'next'));
    const file = path.join(root, 'server.cfg'); await fs.writeFile(file, 'original');
    await assert.rejects(atomicFileWrite(file, 'changed', fileVersion('original'), async () => { await fs.writeFile(file, 'newer external change'); }), /File changed/);
    assert.equal(await fs.readFile(file, 'utf8'), 'newer external change');
    assert.equal((await fs.readdir(dir)).length, 10);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('history never follows a symbolic storage directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-history-link-')); const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-history-outside-'));
  try {
    const dir = path.join(root, '.file-history'); await fs.symlink(outside, dir);
    await assert.rejects(prepareFileHistory(dir, scope, 'operator', Buffer.from('old'), 'new'), /Invalid file history directory/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});
