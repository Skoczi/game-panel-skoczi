import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';
const sql = 'ALTER TABLE server_metrics ADD COLUMN resources_json TEXT;';
export const migration: DatabaseMigration = {
  id: '0004_resource_metrics', appVersion: '2.0.49', checksum: checksumSql(sql),
  async up(database) { await database.exec(sql); },
};
