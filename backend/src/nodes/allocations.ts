import { randomUUID } from 'node:crypto';
import type { Database } from 'sqlite';
import { DEFAULT_APPEARANCE, validateGlobalSettings, type GlobalSettings, type Assignment } from '../services/globalSettingsStore.js';

export type Network = GlobalSettings['network'];
export type RuntimeSettings = { revision: number; network: Network; appearance: Record<string, unknown>; assignments?: Assignment[] };
export type AllocationTarget = { id: string; name: string };
export interface AllocationRuntime {
    targets(): Promise<AllocationTarget[]>;
    read(id: string): Promise<RuntimeSettings>;
    write(id: string, value: RuntimeSettings, operationId: string): Promise<void>;
}
export class AllocationError extends Error {
    constructor(message: string, public statusCode = 409, public definitive = false) { super(message); }
}
type Pending = { node_id: string; operation_id: string; payload: string };

/** One panel process. Claims and outstanding requests survive restarts and uncertain writes. */
export class NodeAllocations {
    private tail: Promise<unknown> = Promise.resolve();
    constructor(private db: Database, private runtime: AllocationRuntime) {}
    async initialize() {
        await this.db.exec(`CREATE TABLE IF NOT EXISTS node_ip_claims (
            ip TEXT PRIMARY KEY, node_id TEXT NOT NULL
        ); CREATE TABLE IF NOT EXISTS node_allocation_updates (
            node_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, payload TEXT NOT NULL
        )`);
    }
    exclusive<T>(run: () => Promise<T>): Promise<T> {
        const result = this.tail.then(run, run);
        this.tail = result.catch(() => {});
        return result;
    }
    async pending(id: string): Promise<Pending | undefined> {
        return this.db.get('SELECT * FROM node_allocation_updates WHERE node_id=?', id);
    }
    async read(id: string) {
        const value = await this.runtime.read(id);
        return { revision: value.revision, network: value.network, assignments: value.assignments || [], pending: Boolean(await this.pending(id)) };
    }
    private async reserve(id: string, network: Network) {
        for (const { ip } of network.allocations) {
            await this.db.run('INSERT OR IGNORE INTO node_ip_claims(ip,node_id) VALUES(?,?)', ip, id);
            const owner = await this.db.get('SELECT node_id FROM node_ip_claims WHERE ip=?', ip);
            if (owner.node_id !== id) {
                const target = (await this.runtime.targets()).find(t => t.id === owner.node_id);
                throw new AllocationError(`IP ${ip} is reserved by ${target?.name || owner.node_id}. Release it on that node first.`);
            }
        }
    }
    private async releaseUnused(id: string, network: Network) {
        await this.db.run('DELETE FROM node_ip_claims WHERE node_id=? AND ip NOT IN (SELECT value FROM json_each(?))', id, JSON.stringify(network.allocations.map(a => a.ip)));
    }
    save(id: string, network: unknown, revision: unknown) {
        return this.exclusive(async () => {
            if (await this.pending(id)) throw new AllocationError('A previous save needs confirmation. Use Retry pending save.');
            const normalized = validateGlobalSettings({ appearance: DEFAULT_APPEARANCE, network }).network;
            const current = await this.runtime.read(id);
            if (!Number.isSafeInteger(revision) || revision !== current.revision)
                throw new AllocationError('Settings changed. Reload before saving.');
            // Discover existing allocations before claiming a new address. Offline/unknown inventories fail closed.
            const targets = await this.runtime.targets();
            for (let offset = 0; offset < targets.length; offset += 4) {
                const batch = await Promise.all(targets.slice(offset, offset + 4).map(async target => {
                    try { return { target, value: target.id === id ? current : await this.runtime.read(target.id) }; }
                    catch { throw new AllocationError(`Cannot verify IP ownership on ${target.name}. Restore its connection before saving allocations.`, 503); }
                }));
                for (const { target, value } of batch) await this.reserve(target.id, value.network);
            }
            try { await this.reserve(id, normalized); }
            catch (error) { await this.releaseUnused(id, current.network); throw error; }
            const pending = { node_id: id, operation_id: randomUUID(), payload: JSON.stringify({ revision, network: normalized, appearance: current.appearance }) };
            await this.db.run('INSERT INTO node_allocation_updates(node_id,operation_id,payload) VALUES(?,?,?)', id, pending.operation_id, pending.payload);
            return this.complete(pending);
        });
    }
    retry(id: string) {
        return this.exclusive(async () => {
            const pending = await this.pending(id);
            if (!pending) return this.read(id);
            return this.complete(pending);
        });
    }
    private async complete(pending: Pending) {
        const payload: RuntimeSettings = JSON.parse(pending.payload);
        try {
            await this.runtime.write(pending.node_id, payload, pending.operation_id);
        } catch (error) {
            if (!(error instanceof AllocationError) || !error.definitive)
                throw new AllocationError('Save outcome is not confirmed. IP reservations are retained. Use Retry pending save when the node is reachable.', 503);
            const current = await this.runtime.read(pending.node_id);
            await this.reserve(pending.node_id, current.network);
            await this.releaseUnused(pending.node_id, current.network);
            await this.db.run('DELETE FROM node_allocation_updates WHERE node_id=?', pending.node_id);
            throw error;
        }
        const current = await this.runtime.read(pending.node_id);
        if (JSON.stringify(current.network) !== JSON.stringify(payload.network))
            throw new AllocationError('Agent configuration differs from the saved request. Reservations remain held; reconcile this node before retrying.');
        await this.reserve(pending.node_id, current.network);
        await this.releaseUnused(pending.node_id, current.network);
        await this.db.run('DELETE FROM node_allocation_updates WHERE node_id=?', pending.node_id);
        return { revision: current.revision, network: current.network, assignments: current.assignments || [], pending: false };
    }
    async removeNode(id: string, remove: () => Promise<void>) {
        return this.exclusive(async () => {
            if (await this.pending(id)) throw new AllocationError('Resolve the pending allocation save before deleting this node.');
            await remove();
            await this.db.run('DELETE FROM node_ip_claims WHERE node_id=?', id);
        });
    }
}
