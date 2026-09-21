import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';

test('the actual upstream 1.5.0 schema migrates without losing accounts, memberships or games', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('./fixtures/upstream-1.5.0.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES(1,'operator','unchanged-password-hash','2026-09-01','2026-09-01');
      INSERT INTO game_servers(id,name,provider,docker_image,ports_json,created_at,updated_at) VALUES(7,'Existing game','linuxgsm','existing-image','[]','2026-09-01','2026-09-01');
      INSERT INTO server_members(server_id,user_id,permissions_json,created_at,updated_at) VALUES(7,1,'["fs.read"]','2026-09-01','2026-09-01');`);
    const original = JSON.stringify(db.prepare('SELECT * FROM users').all());
    const members = JSON.stringify(db.prepare('SELECT * FROM server_members').all());
    // v1.5.0 already includes migration 0001; apply only later migrations.
    for (const migration of DATABASE_MIGRATIONS.filter(m => m.id !== '0001_file_transfer_jobs_add_extract_kind')) {
      await migration.up({ exec: async (sql: string) => db.exec(sql) } as any);
    }
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM users').all()), original);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM server_members').all()), members);
    const server = db.prepare('SELECT * FROM game_servers WHERE id=7').get()!;
    assert.equal(server.name, 'Existing game'); assert.equal(server.docker_image, 'existing-image');
    assert.match(String(server.runtime_uuid), /^[a-f0-9]{32}$/);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});
