import type { Database } from 'sqlite';

type Operation = { id: string; fingerprint: string; state: string; status: number; response: string; created_at: number };
/** Persistent admission, not an automatic retry queue. Tombstones are retained. */
export class OperationJournal {
    constructor(private db: Database) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS agent_requests (
          id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL,
          status INTEGER, response TEXT, created_at INTEGER NOT NULL
        ); UPDATE agent_requests SET state='uncertain' WHERE state='running'`);
    }
    async admit(id: string, fingerprint: string): Promise<Operation | undefined> {
        const result = await this.db.run('INSERT OR IGNORE INTO agent_requests(id,fingerprint,state,created_at) VALUES(?,?,?,?)', id, fingerprint, 'running', Date.now());
        if (result.changes === 1) return;
        const previous = await this.db.get<Operation>('SELECT * FROM agent_requests WHERE id=?', id);
        if (!previous) throw new Error('Operation journal inconsistent');
        return previous;
    }
    async complete(id: string, status: number, response: string) {
        await this.db.run("UPDATE agent_requests SET state='completed',status=?,response=? WHERE id=?", status, response, id);
    }
    async uncertain(id: string) { await this.db.run("UPDATE agent_requests SET state='uncertain' WHERE id=?", id); }
    async lookup(id: string) {
        // Never expose cached command responses (which can contain secrets) in diagnostics.
        return this.db.get('SELECT id,state,status,created_at FROM agent_requests WHERE id=?', id);
    }
}
