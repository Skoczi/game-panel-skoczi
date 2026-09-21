import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite';
import { CS16_TEMPLATE, TemplateError, validateTemplate, templateHash } from './schema.js';
import { NATIVE_CS16_TEMPLATE } from './nativeCs16.js';

export class TemplateStore {
    constructor(private db: Database) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS game_template_versions (
            id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','disabled')),
            document TEXT NOT NULL, hash TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY(id, version));
            CREATE TABLE IF NOT EXISTS game_template_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT, template_id TEXT NOT NULL, version INTEGER NOT NULL,
            actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS game_template_deleted (
            template_id TEXT PRIMARY KEY, actor TEXT NOT NULL, deleted_at TEXT NOT NULL);`);
        // INSERT OR IGNORE never overwrites administrator changes, including disabling a bundled template.
        const t = validateTemplate(CS16_TEMPLATE);
        await this.db.run(`INSERT OR IGNORE INTO game_template_versions VALUES(?,1,'draft',?,?,?,?)`, 'builtin-cs16', JSON.stringify(t), templateHash(t), 'bundled', new Date().toISOString());
        const native = validateTemplate(NATIVE_CS16_TEMPLATE);
        await this.db.run(`INSERT OR IGNORE INTO game_template_versions VALUES(?,1,'draft',?,?,?,?)`, 'builtin-cs16-native', JSON.stringify(native), templateHash(native), 'bundled', new Date().toISOString());
    }
    async list() {
        const rows = await this.db.all(`SELECT * FROM game_template_versions WHERE id NOT IN
            (SELECT template_id FROM game_template_deleted) ORDER BY created_at DESC, version DESC`);
        return rows.map((r: any) => ({ ...r, document: JSON.parse(r.document) }));
    }
    async get(id: string, version: number) {
        if (await this.db.get('SELECT 1 FROM game_template_deleted WHERE template_id=?', id)) throw new TemplateError('Template has been deleted', 404);
        const row = await this.db.get(`SELECT * FROM game_template_versions WHERE id=? AND version=?`, id, version);
        if (!row) throw new TemplateError('Template version not found', 404);
        return { ...row, document: validateTemplate(JSON.parse(row.document)) };
    }
    // Tombstones preserve immutable server snapshots and audit history, and stop bundled
    // definitions from reappearing after restart. Recovery is an operator action.
    async remove(id: string, actor: string) {
        const row = await this.db.get('SELECT MAX(version) AS version FROM game_template_versions WHERE id=?', id);
        if (!row?.version) throw new TemplateError('Template not found', 404);
        await this.db.run('INSERT OR IGNORE INTO game_template_deleted VALUES(?,?,?)', id, actor, new Date().toISOString());
        return { deleted: true, id };
    }
    async create(document: unknown, actor: string, id: string = randomUUID(), baseVersion = 0) {
        const t = validateTemplate(document);
        const version = baseVersion + 1;
        if (baseVersion) await this.get(id, baseVersion);
        try {
            // Atomic compare-and-insert. Two editors of the same revision cannot overwrite each other.
            const result = await this.db.run(`INSERT INTO game_template_versions(id,version,status,document,hash,actor,created_at)
              SELECT ?,?,'draft',?,?,?,? WHERE COALESCE((SELECT MAX(version) FROM game_template_versions WHERE id=?),0)=?`,
                id, version, JSON.stringify(t), templateHash(t), actor, new Date().toISOString(), id, baseVersion);
            if (!result.changes) throw new TemplateError('A newer version exists. Reload before saving.', 409);
        } catch (e) { if (e instanceof TemplateError) throw e; throw new TemplateError('Version conflict. Reload before saving.', 409); }
        return this.get(id, version);
    }
    async status(id: string, version: number, status: 'published' | 'disabled', actor: string) {
        const row = await this.get(id, version);
        if (row.status === status) return row;
        if (status === 'published' && row.status !== 'draft') throw new TemplateError('Create a new draft to republish a disabled version', 409);
        const result = await this.db.run('UPDATE game_template_versions SET status=? WHERE id=? AND version=? AND status=?', status, id, version, row.status);
        if (!result.changes) throw new TemplateError('Status changed. Reload before trying again.', 409);
        await this.db.run('INSERT INTO game_template_audit(template_id,version,actor,action,created_at) VALUES(?,?,?,?,?)', id, version, actor, status, new Date().toISOString());
        return this.get(id, version);
    }
}
