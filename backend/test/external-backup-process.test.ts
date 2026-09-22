import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './loadWithMocks.js';

test('a stuck network worker times out without waiting for a kill/exit callback', async () => {
  let deadline: () => void = () => {};
  let callback: (error: unknown, stdout: string) => void = () => {};
  const signals: string[] = [], sent: string[] = [];
  const { runExternalBackupWorker } = loadWithMocks('../src/services/externalBackupProcess.ts', {
    'node:child_process': { execFile: (_exe: string, args: string[], _options: unknown, cb: typeof callback) => {
      assert.deepEqual(Array.from(args), ['/worker.js']); callback = cb;
      return { kill: (signal: string) => signals.push(signal), stdin: { on: () => {}, end: (payload: string) => sent.push(payload) } };
    } },
  }, { process: { execPath: '/node' }, setTimeout: (cb: () => void) => { deadline = cb; return 1; }, clearTimeout: () => {} });
  const task = runExternalBackupWorker('/worker.js', { token: 'private' }, 100);
  const rejected = assert.rejects(task, /timed out/);
  deadline(); await rejected;
  assert.deepEqual(signals, ['SIGKILL']); assert.equal(sent[0], '{"token":"private"}');
  // A late success cannot retroactively mark the operation successful.
  callback(null, '{"result":{"ok":true}}');
});

test('confirmed results clear the deadline; malformed worker output fails closed', async () => {
  let callback: (error: unknown, stdout: string) => void = () => {};
  let cleared = 0;
  const { runExternalBackupWorker } = loadWithMocks('../src/services/externalBackupProcess.ts', {
    'node:child_process': { execFile: (_exe: unknown, _args: unknown, _options: unknown, cb: typeof callback) => {
      callback = cb; return { kill: () => assert.fail('completed worker killed'), stdin: { on: () => {}, end: () => {} } };
    } },
  }, { process: { execPath: '/node' }, setTimeout: () => 1, clearTimeout: () => { cleared++; } });
  const task = runExternalBackupWorker('/worker.js', {}, 100);
  callback(null, '{"result":{"ok":true}}'); assert.equal((await task).ok, true); assert.equal(cleared, 1);
  const malformed = runExternalBackupWorker('/worker.js', {}, 100);
  callback(null, '<html>'); await assert.rejects(malformed, /confirmed result/); assert.equal(cleared, 2);
});
