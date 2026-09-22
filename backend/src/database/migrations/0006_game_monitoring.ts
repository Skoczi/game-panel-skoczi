import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';
const sql = `CREATE TABLE game_monitoring (
  server_id INTEGER PRIMARY KEY REFERENCES game_servers(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);`;
export const migration: DatabaseMigration = {
    id: '0006_game_monitoring', appVersion: '2.0.56', checksum: checksumSql(sql),
    async up(database) { await database.exec(sql); },
};
