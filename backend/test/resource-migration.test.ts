import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migration } from '../src/database/migrations/0004_resource_metrics.js';

test('resource migration preserves existing measurements and fresh schema includes the same column', async () => {
 const source = readFileSync(new URL('../src/database/init.ts', import.meta.url), 'utf8');
 const schema = source.match(/CREATE TABLE IF NOT EXISTS server_metrics \([\s\S]*?\n      \)/)![0];
 const fresh = new DatabaseSync(':memory:'); const legacy = new DatabaseSync(':memory:');
 try {
  fresh.exec(schema);
  assert(fresh.prepare('PRAGMA table_info(server_metrics)').all().some((row: any) => row.name === 'resources_json'));
  legacy.exec('CREATE TABLE game_servers (id INTEGER PRIMARY KEY); INSERT INTO game_servers VALUES (1)');
  legacy.exec(schema.replace('resources_json TEXT,', ''));
  legacy.exec("INSERT INTO server_metrics (server_id, timestamp, cpu_usage) VALUES (1, '2026-09-20T00:00:00Z', 25)");
  await migration.up({ exec: async (sql: string) => legacy.exec(sql) } as any);
  const row = legacy.prepare('SELECT * FROM server_metrics').get()!;
  assert.equal(row.cpu_usage, 25); assert.equal(row.resources_json, null);
  legacy.prepare('UPDATE server_metrics SET resources_json = ?').run(JSON.stringify({ cpuCores: 0.5 }));
  assert.equal(JSON.parse(legacy.prepare('SELECT resources_json FROM server_metrics').get()!.resources_json as string).cpuCores, 0.5);
 } finally { fresh.close(); legacy.close(); }
});
