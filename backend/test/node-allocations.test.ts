import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NodeAllocations, AllocationError, type AllocationRuntime, type Network, type RuntimeSettings } from '../src/nodes/allocations.js';
import { DEFAULT_APPEARANCE } from '../src/services/globalSettingsStore.js';

const network = (...ips: string[]): Network => ({ restrictPorts: true, allocations: ips.map(ip => ({ ip, alias: '', tcp: '27015-27030', udp: '27015' })) });
async function fixture() {
    const native = new DatabaseSync(':memory:');
    const db = {
        exec: async (sql: string) => native.exec(sql),
        run: async (sql: string, ...args: any[]) => native.prepare(sql).run(...args),
        get: async (sql: string, ...args: any[]) => native.prepare(sql).get(...args),
        all: async (sql: string, ...args: any[]) => native.prepare(sql).all(...args),
    } as any;
    const values = new Map<string, RuntimeSettings>(['local', 'remote'].map(id => [id, { revision: 1, appearance: DEFAULT_APPEARANCE, network: network() }]));
    const writes: string[] = [];
    const runtime: AllocationRuntime = {
        targets: async () => [...values.keys()].map(id => ({ id, name: id })),
        read: async id => structuredClone(values.get(id)!),
        write: async (id, value, operation) => { writes.push(operation); values.set(id, { ...value, revision: value.revision + 1 }); },
    };
    const service = new NodeAllocations(db, runtime); await service.initialize();
    return { native, db, values, writes, runtime, service };
}
test('allocations are unique across nodes, including Local, and can be released for another node', async () => {
    const f = await fixture();
    try {
        await f.service.save('local', network('192.0.2.10'), 1);
        await assert.rejects(f.service.save('remote', network('192.0.2.10'), 1), /reserved by local/);
        assert.equal(f.writes.length, 1);
        await f.service.save('local', network(), 2);
        await f.service.save('remote', network('192.0.2.10'), 1);
        assert.equal(f.values.get('remote')!.network.allocations[0].ip, '192.0.2.10');
        await assert.rejects(f.service.save('remote', network(), 1), /Reload/);
        await assert.rejects(f.service.save('local', network('192.0.2.10', '192.0.2.10'), 3), /unique/);
    } finally { f.native.close(); }
});
test('parallel claims have one winner and existing agent allocations are discovered first', async () => {
    const f = await fixture();
    try {
        f.values.get('remote')!.network = network('192.0.2.50');
        await assert.rejects(f.service.save('local', network('192.0.2.50'), 1), /reserved by remote/);
        const results = await Promise.allSettled([
            f.service.save('local', network('192.0.2.11'), 1),
            f.service.save('remote', network('192.0.2.11'), 1),
        ]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(f.writes.length, 1);
    } finally { f.native.close(); }
});
test('uncertain writes retain claims across restarts and retry the identical operation', async () => {
    const f = await fixture();
    try {
        const original = f.runtime.write;
        f.runtime.write = async (id, value, operation) => { await original(id, value, operation); throw new Error('Response lost'); };
        await assert.rejects(f.service.save('remote', network('192.0.2.12'), 1), /not confirmed/);
        const restarted = new NodeAllocations(f.db, f.runtime); await restarted.initialize();
        assert.equal((await restarted.read('remote')).pending, true);
        await assert.rejects(restarted.save('local', network('192.0.2.12'), 1), /reserved by remote/);
        await assert.rejects(restarted.save('remote', network(), 2), /previous save/);
        await assert.rejects(restarted.removeNode('remote', async () => { throw new Error('Must not delete'); }), /pending allocation/);
        f.runtime.write = async (_id, _value, operation) => { assert.equal(operation, f.writes[0]); };
        await restarted.retry('remote');
        assert.equal((await restarted.read('remote')).pending, false);
        await assert.rejects(restarted.save('local', network('192.0.2.12'), 1), /reserved by remote/);
    } finally { f.native.close(); }
});
test('confirmed validation rejection releases attempted IPs, while unreachable inventories never allow a write', async () => {
    const f = await fixture();
    try {
        const original = f.runtime.write;
        f.runtime.write = async () => { throw new AllocationError('Allocation in use', 409, true); };
        await assert.rejects(f.service.save('remote', network('192.0.2.13'), 1), /in use/);
        assert.equal((await f.service.read('remote')).pending, false);
        f.runtime.write = original;
        await f.service.save('local', network('192.0.2.13'), 1);
        const read = f.runtime.read;
        f.runtime.read = async id => { if (id === 'remote') throw new Error('Offline'); return read(id); };
        await assert.rejects(f.service.save('local', network('192.0.2.14'), 2), /Cannot verify IP ownership on remote/);
        assert.equal(f.writes.length, 1);
    } finally { f.native.close(); }
});
