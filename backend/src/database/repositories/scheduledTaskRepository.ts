import type { ScheduledTaskRow } from '../../types/database.js';
import { nowIso } from '../../utils/time.js';
import { BaseRepository } from './base.js';

export type CreateScheduledTaskInput = {
  serverId: number;
  type: ScheduledTaskRow['type'];
  schedule: string;
  enabled: boolean;
  payload: Record<string, unknown>;
  nextRunAt: string | null;
};

export type UpdateScheduledTaskInput = Partial<{
  type: ScheduledTaskRow['type'];
  schedule: string;
  enabled: boolean;
  payload: Record<string, unknown>;
  nextRunAt: string | null;
}>;

export class ScheduledTaskRepository extends BaseRepository {
  async create(input: CreateScheduledTaskInput): Promise<ScheduledTaskRow> {
    const db = await this.ensureDb();
    const timestamp = nowIso();
    const result = await db.run(
      `INSERT INTO server_scheduled_tasks
       (server_id, type, schedule, enabled, payload_json, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.serverId,
        input.type,
        input.schedule,
        input.enabled ? 1 : 0,
        JSON.stringify(input.payload ?? {}),
        input.nextRunAt,
        timestamp,
        timestamp,
      ]
    );

    const row = await this.findById(result.lastID as number);
    if (!row) throw new Error('Created scheduled task could not be loaded');
    return row;
  }

  async findById(id: number): Promise<ScheduledTaskRow | undefined> {
    const db = await this.ensureDb();
    return db.get<ScheduledTaskRow>(
      'SELECT * FROM server_scheduled_tasks WHERE id = ?',
      [id]
    );
  }

  async findByIdForServer(id: number, serverId: number): Promise<ScheduledTaskRow | undefined> {
    const db = await this.ensureDb();
    return db.get<ScheduledTaskRow>(
      'SELECT * FROM server_scheduled_tasks WHERE id = ? AND server_id = ?',
      [id, serverId]
    );
  }

  async listForServer(serverId: number): Promise<ScheduledTaskRow[]> {
    const db = await this.ensureDb();
    return db.all<ScheduledTaskRow[]>(
      `SELECT * FROM server_scheduled_tasks
       WHERE server_id = ?
       ORDER BY id ASC`,
      [serverId]
    );
  }

  async listDue(nowIso: string, limit = 20, busyServerIds: number[] = []): Promise<ScheduledTaskRow[]> {
    const db = await this.ensureDb();
    const excluded = busyServerIds.length ? `AND task.server_id NOT IN (${busyServerIds.map(() => '?').join(',')})` : '';
    return db.all<ScheduledTaskRow[]>(
      `SELECT task.* FROM server_scheduled_tasks task
       WHERE task.enabled = 1
         AND task.next_run_at <= ?
         AND task.locked_at IS NULL
         ${excluded}
         AND NOT EXISTS (
           SELECT 1 FROM server_scheduled_tasks other
           WHERE other.server_id = task.server_id AND (
             other.locked_at IS NOT NULL OR
             (other.enabled = 1 AND (other.next_run_at < task.next_run_at OR
               (other.next_run_at = task.next_run_at AND other.id < task.id)))
           )
         )
       ORDER BY task.next_run_at ASC, task.id ASC
       LIMIT ?`,
      [nowIso, ...busyServerIds, limit]
    );
  }

  async recoverInterrupted(activeTaskIds: number[] = []): Promise<ScheduledTaskRow[]> {
    const db = await this.ensureDb();
    const excluded = activeTaskIds.length ? `AND id NOT IN (${activeTaskIds.map(() => '?').join(',')})` : '';
    // One durable transition: a crash after this statement cannot make the old run due again.
    return db.all<ScheduledTaskRow[]>(
      `UPDATE server_scheduled_tasks
       SET enabled = 0, next_run_at = NULL, last_run_at = locked_at,
           last_status = 'interrupted', last_error = ?, locked_at = NULL, updated_at = ?
       WHERE locked_at IS NOT NULL ${excluded}
       RETURNING *`,
      ['Agent stopped before this task finished. Some commands may have run; cleanup is not confirmed. Check the server before enabling this schedule again.', nowIso(), ...activeTaskIds]
    );
  }

  async update(id: number, input: UpdateScheduledTaskInput): Promise<ScheduledTaskRow | undefined> {
    const db = await this.ensureDb();
    const current = await this.findById(id);
    if (!current) return undefined;

    const result = await db.run(
      `UPDATE server_scheduled_tasks
       SET type = ?,
           schedule = ?,
           enabled = ?,
           payload_json = ?,
           next_run_at = ?,
           updated_at = ?
       WHERE id = ? AND locked_at IS NULL`,
      [
        input.type ?? current.type,
        input.schedule ?? current.schedule,
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled,
        input.payload !== undefined ? JSON.stringify(input.payload) : current.payload_json,
        input.nextRunAt !== undefined ? input.nextRunAt : current.next_run_at,
        nowIso(),
        id,
      ]
    );

    if (!result.changes && await this.findById(id)) {
      throw Object.assign(new Error('This task is running. Wait for it to finish before editing it.'), { statusCode: 409 });
    }
    return this.findById(id);
  }

  async lock(id: number, lockedAt: string): Promise<boolean> {
    const db = await this.ensureDb();
    const result = await db.run(
      `UPDATE server_scheduled_tasks
       SET locked_at = ?, updated_at = ?
       WHERE id = ? AND locked_at IS NULL AND enabled = 1 AND next_run_at <= ?`,
      [lockedAt, nowIso(), id, lockedAt]
    );
    return Number(result.changes ?? 0) > 0;
  }

  async finish(id: number, input: {
    nextRunAt: string | null;
    lastStatus: string;
    lastError?: string | null;
  }): Promise<void> {
    const db = await this.ensureDb();
    const timestamp = nowIso();
    await db.run(
      `UPDATE server_scheduled_tasks
       SET last_run_at = ?,
           next_run_at = ?,
           last_status = ?,
           last_error = ?,
           locked_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      [timestamp, input.nextRunAt, input.lastStatus, input.lastError ?? null, timestamp, id]
    );
  }

  async unlock(id: number): Promise<void> {
    const db = await this.ensureDb();
    await db.run(
      `UPDATE server_scheduled_tasks
       SET locked_at = NULL, updated_at = ?
       WHERE id = ?`,
      [nowIso(), id]
    );
  }

  async delete(id: number): Promise<void> {
    const db = await this.ensureDb();
    const result = await db.run('DELETE FROM server_scheduled_tasks WHERE id = ? AND locked_at IS NULL', [id]);
    if (!result.changes && await this.findById(id)) {
      throw Object.assign(new Error('This task is running. Wait for it to finish before deleting it.'), { statusCode: 409 });
    }
  }
}
