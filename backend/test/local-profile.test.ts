import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { LocalProfileStore, validateLocalProfile } from '../src/nodes/localProfile.js';

test('local profile validates display-only origins and bounded text', () => {
  const valid = { name: ' WAW2 ', location: 'Warsaw, PL', origin: 'https://eserv.pl/' };
  assert.deepEqual(validateLocalProfile(valid), { name: 'WAW2', location: 'Warsaw, PL', origin: 'https://eserv.pl' });
  for (const origin of ['javascript:alert(1)', 'https://a:b@example.com', 'https://example.com/path', 'https://example.com/?secret=x', 'https://example.com/#x'])
    assert.throws(() => validateLocalProfile({ ...valid, origin }));
  for (const name of ['', ' ', 'x'.repeat(81), 'a\nb']) assert.throws(() => validateLocalProfile({ ...valid, name }));
  assert.throws(() => validateLocalProfile({ ...valid, enabled: false }));
  assert.equal(validateLocalProfile({ ...valid, origin: '' }).origin, '');
});
test('local identity persists across initialization without touching remote nodes', async () => {
  const native = new DatabaseSync(':memory:');
  const db = { exec: async (sql: string) => native.exec(sql), run: async (sql: string, ...args: any[]) => native.prepare(sql).run(...args), get: async (sql: string) => native.prepare(sql).get() } as any;
  try {
    const store = new LocalProfileStore(db); await store.initialize();
    assert.equal((await store.read())?.name, 'Local');
    await store.save({ name: 'WAW2', location: 'Warsaw', origin: '' });
    await store.initialize(); assert.equal((await store.read())?.name, 'WAW2');
    await assert.rejects(store.save({ name: '' }));
    assert.equal((await store.read())?.name, 'WAW2');
  } finally { native.close(); }
});
