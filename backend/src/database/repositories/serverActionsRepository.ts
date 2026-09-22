import { alertForAction } from '../../services/alerts.js';
import { logError } from '../../utils/logger.js';
import { bus } from '../../realtime/bus.js';
import type { ServerActionRow } from '../../types/database.js';
import { nowIso } from '../../utils/time.js';
import { BaseRepository } from './base.js';

export class ServerActionsRepository extends BaseRepository {
  async create(serverId: number, level: string, message: string, actorUsername: string, timestamp = nowIso()) {
    const db = await this.ensureDb();
    const result = await db.run(
      'INSERT INTO server_actions (server_id, timestamp, level, message, actor_username) VALUES (?, ?, ?, ?, ?)',
      [serverId, timestamp, level, message, actorUsername]
    );
    const id = result.lastID as number;

    const keepCount = 100;
    await db.run(
      `
      DELETE FROM server_actions
      WHERE server_id = ?
        AND id NOT IN (
          SELECT id
          FROM server_actions
          WHERE server_id = ?
          ORDER BY id DESC
          LIMIT ?
        )
      `,
      [serverId, serverId, keepCount]
    );

    bus.emit('server.action', {
      serverId,
      level,
      message,
      actorUsername,
      actionId: id,
      timestamp,
    });

    await alertForAction(serverId, level, message, actorUsername).catch(error => logError('ALERT:QUEUE', error));
    return id;
  }

  async getRecent(serverId: number, limit = 100): Promise<ServerActionRow[]> {
    const db = await this.ensureDb();
    return db.all<ServerActionRow[]>(
      'SELECT * FROM server_actions WHERE server_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?',
      [serverId, limit]
    );
  }

}
