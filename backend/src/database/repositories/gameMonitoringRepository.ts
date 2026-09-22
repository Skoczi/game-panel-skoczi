import { BaseRepository } from './base.js';
import type { GameMonitoringConfig, GameMonitoringSnapshot } from '../../templates/types.js';

export type MonitoringRecord = { config: GameMonitoringConfig; snapshot: GameMonitoringSnapshot; revision: number };
export class GameMonitoringRepository extends BaseRepository {
    async get(id: number): Promise<MonitoringRecord | null> {
        const db = await this.ensureDb();
        const row = await db.get('SELECT * FROM game_monitoring WHERE server_id = ?', [id]);
        return row ? { config: JSON.parse(row.config_json), snapshot: JSON.parse(row.snapshot_json), revision: row.revision } : null;
    }
    async ensure(id: number, config: GameMonitoringConfig, snapshot: GameMonitoringSnapshot) {
        const db = await this.ensureDb();
        await db.run('INSERT OR IGNORE INTO game_monitoring (server_id, config_json, snapshot_json) VALUES (?, ?, ?)', [id, JSON.stringify(config), JSON.stringify(snapshot)]);
        return (await this.get(id))!;
    }
    async configure(id: number, config: GameMonitoringConfig, snapshot: GameMonitoringSnapshot) {
        const db = await this.ensureDb();
        await db.run(`INSERT INTO game_monitoring (server_id, config_json, snapshot_json) VALUES (?, ?, ?)
          ON CONFLICT(server_id) DO UPDATE SET config_json=excluded.config_json, snapshot_json=excluded.snapshot_json, revision=revision+1`, [id, JSON.stringify(config), JSON.stringify(snapshot)]);
    }
    async observe(id: number, revision: number, snapshot: GameMonitoringSnapshot) {
        const db = await this.ensureDb();
        const result = await db.run('UPDATE game_monitoring SET snapshot_json=? WHERE server_id=? AND revision=?', [JSON.stringify(snapshot), id, revision]);
        return result.changes === 1;
    }
}
export const gameMonitoringRepository = new GameMonitoringRepository();
