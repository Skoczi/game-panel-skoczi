import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';

export const RUNTIME_IDENTITY_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_server_runtime_uuid ON game_servers(runtime_uuid);
CREATE TRIGGER IF NOT EXISTS assign_server_runtime_uuid AFTER INSERT ON game_servers
WHEN NEW.runtime_uuid IS NULL BEGIN
  UPDATE game_servers SET runtime_uuid=lower(hex(randomblob(16))) WHERE id=NEW.id;
END;
`;
const sql = `ALTER TABLE game_servers ADD COLUMN runtime_uuid TEXT;
UPDATE game_servers SET runtime_uuid=lower(hex(randomblob(16))) WHERE runtime_uuid IS NULL;
${RUNTIME_IDENTITY_SQL}`;
export const migration: DatabaseMigration = {
    id: '0002_server_runtime_identity',
    appVersion: '1.5.0-skoczi.8',
    checksum: checksumSql(sql),
    async up(database) {
        await database.exec(sql);
    },
};
