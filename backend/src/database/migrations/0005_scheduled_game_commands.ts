import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';

// SQLite CHECK constraints require a table rebuild. Preserve every existing task and its state.
const sql = `
CREATE TABLE server_scheduled_tasks_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('restart','backup','custom','game_command')),
  schedule TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  next_run_at TEXT,
  last_run_at TEXT,
  last_status TEXT,
  last_error TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (server_id) REFERENCES game_servers(id) ON DELETE CASCADE
);
INSERT INTO server_scheduled_tasks_next SELECT * FROM server_scheduled_tasks;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'server_scheduled_tasks'), 0))
  WHERE name = 'server_scheduled_tasks_next';
DROP TABLE server_scheduled_tasks;
ALTER TABLE server_scheduled_tasks_next RENAME TO server_scheduled_tasks;
CREATE INDEX idx_scheduled_tasks_due ON server_scheduled_tasks(enabled, next_run_at, locked_at);
CREATE INDEX idx_scheduled_tasks_server ON server_scheduled_tasks(server_id);
`;

export const migration: DatabaseMigration = {
  id: '0005_scheduled_game_commands',
  appVersion: '2.0.54',
  checksum: checksumSql(sql),
  async up(database) { await database.exec(sql); },
};
