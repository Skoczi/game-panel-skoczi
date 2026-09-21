import { createHash, randomUUID } from 'node:crypto';
import type { Database } from 'sqlite';
export type ApiOperation = {
    id: string; token_id: string; owner_id: number; server_id: string;
    node_id: string; runtime_id: number; runtime_key: string;
    fingerprint: string; request_key: string; state: 'admitted' | 'started' | 'uncertain';
    job_id: string | null; created_at: number;
};
/** Admission is durable before dispatch. Interrupted or ambiguous requests are NEVER dispatched again. */
export class ApiOperationStore {
    constructor(private db: Database) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS api_operations (
            id TEXT PRIMARY KEY, token_id TEXT NOT NULL, owner_id INTEGER NOT NULL,
            server_id TEXT NOT NULL, node_id TEXT NOT NULL, runtime_id INTEGER NOT NULL,
            runtime_key TEXT NOT NULL, fingerprint TEXT NOT NULL, request_key TEXT NOT NULL,
            state TEXT NOT NULL, job_id TEXT, created_at INTEGER NOT NULL,
            UNIQUE(token_id,request_key)
        ); UPDATE api_operations SET state='uncertain' WHERE state='admitted'`);
    }
    async admit(input: { tokenId: string; ownerId: number; serverId: string; nodeId: string;
        runtimeId: number; runtimeKey: string; key: string; name: string }) {
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.key)) throw new Error('Invalid idempotency key');
        const fingerprint = createHash('sha256').update(JSON.stringify({ server: input.serverId, name: input.name })).digest('hex');
        const id = randomUUID();
        const result = await this.db.run(`INSERT OR IGNORE INTO api_operations
            (id,token_id,owner_id,server_id,node_id,runtime_id,runtime_key,fingerprint,request_key,state,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,'admitted',?)`, id, input.tokenId, input.ownerId, input.serverId,
            input.nodeId, input.runtimeId, input.runtimeKey, fingerprint, input.key, Date.now());
        const operation = await this.db.get<ApiOperation>('SELECT * FROM api_operations WHERE token_id=? AND request_key=?', input.tokenId, input.key);
        if (!operation) throw new Error('Operation admission unavailable');
        return { operation, fresh: result.changes === 1, conflict: operation.fingerprint !== fingerprint };
    }
    async started(id: string, jobId: string) {
        const result = await this.db.run("UPDATE api_operations SET state='started',job_id=? WHERE id=? AND state='admitted'", jobId, id);
        if (result.changes !== 1) throw new Error('Operation admission changed');
    }
    async uncertain(id: string) {
        await this.db.run("UPDATE api_operations SET state='uncertain' WHERE id=? AND state='admitted'", id);
    }
    async get(id: string) {
        return this.db.get<ApiOperation>('SELECT * FROM api_operations WHERE id=?', id);
    }
}
