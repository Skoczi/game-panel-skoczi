import type { DatabaseMigration } from './types.js';
import { checksumSql } from './checksum.js';
export const MONITORING_ALERTS_SQL = `
CREATE TABLE alert_settings (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL);
CREATE TABLE alert_events (id TEXT PRIMARY KEY, source TEXT NOT NULL, category TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, result TEXT);
CREATE INDEX alert_events_pending ON alert_events(state,next_at,created_at);
CREATE TABLE node_alert_state (node_id TEXT PRIMARY KEY, offline INTEGER NOT NULL, since INTEGER NOT NULL);
CREATE TABLE monitoring_restarts (id TEXT PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES game_servers(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, state TEXT NOT NULL, result TEXT);
CREATE INDEX monitoring_restarts_server ON monitoring_restarts(server_id,created_at);
`;
export const migration: DatabaseMigration = {
    id: '0007_monitoring_alerts', appVersion: '2.0.58', checksum: checksumSql(MONITORING_ALERTS_SQL),
    async up(db) { await db.exec(MONITORING_ALERTS_SQL); },
};
