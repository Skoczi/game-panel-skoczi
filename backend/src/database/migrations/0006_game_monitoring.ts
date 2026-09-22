import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';
export const GAME_MONITORING_SQL = `CREATE TABLE game_monitoring (
  server_id INTEGER PRIMARY KEY REFERENCES game_servers(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);`;
export const migration: DatabaseMigration = {
    id: '0006_game_monitoring', appVersion: '2.0.56', checksum: checksumSql(GAME_MONITORING_SQL),
    async up(database) { await database.exec(GAME_MONITORING_SQL); },
};
