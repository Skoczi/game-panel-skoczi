import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorageReserveGuard, STORAGE_RESERVE_BYTES } from '../src/services/storageReserve.js';
test('reserve guard rejects before starting, including unknown space', async () => {
  for (const value of [0, STORAGE_RESERVE_BYTES - 1, NaN]) {
    let started = false;
    await assert.rejects(createStorageReserveGuard(async () => value)('/tmp', async () => { started = true; }), /Not enough free space/);
    assert.equal(started, false);
  }
});
test('reserve guard aborts a running operation when free space drops and releases its timer', async () => {
  let calls = 0; let aborted = false;
  const guard = createStorageReserveGuard(async () => ++calls === 1 ? STORAGE_RESERVE_BYTES * 2 : 1024, 5);
  await assert.rejects(guard('/tmp', signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  })), /available 0.0 MiB/);
  assert(aborted); const finished = calls;
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, finished);
});
test('reserve guard checks short operations before publication and preserves ordinary failures', async () => {
  let calls = 0;
  await assert.rejects(createStorageReserveGuard(async () => ++calls === 1 ? STORAGE_RESERVE_BYTES * 2 : 0)('/tmp', async () => 'output'), /Not enough free space/);
  await assert.rejects(createStorageReserveGuard(async () => STORAGE_RESERVE_BYTES * 2)('/tmp', async () => { throw new Error('archive failed'); }), /archive failed/);
});
