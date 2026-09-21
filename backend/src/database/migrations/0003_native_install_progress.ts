import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';

// Progress is a protocol string: native recipes add named, ordered step keys.
const sql = `
CREATE TABLE installation_progress_native (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 server_id INTEGER NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE,
 progress_percent INTEGER DEFAULT 0,
 status TEXT DEFAULT 'pending',
 error_message TEXT, started_at TEXT NOT NULL, completed_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO installation_progress_native SELECT * FROM installation_progress;
DROP TABLE installation_progress;
ALTER TABLE installation_progress_native RENAME TO installation_progress;
CREATE INDEX idx_install_progress_server ON installation_progress(server_id);
CREATE TABLE IF NOT EXISTS native_operation_logs (
 server_id INTEGER PRIMARY KEY REFERENCES game_servers(id) ON DELETE CASCADE,
 lines_json TEXT NOT NULL
);
`;
export const migration: DatabaseMigration = {
 id: '0003_native_install_progress', appVersion: '1.5.0-skoczi.15', checksum: checksumSql(sql),
 async up(database) { await database.exec(sql); },
};
