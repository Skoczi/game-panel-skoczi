import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import type { NormalizedResourceLimits } from '../utils/resourceLimits.js';

export function parseCpuList(value: string): number[] {
    if (!value.trim()) return [];
    const ids = new Set<number>();
    for (const part of value.trim().split(',')) {
        if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error('Invalid CPU list');
        const [start, end = start] = part.split('-').map(Number);
        if (!Number.isSafeInteger(end) || start > end || end > 65535 || end - start > 4095) throw new Error('Invalid CPU range');
        for (let id = start; id <= end; id++) ids.add(id);
        if (ids.size > 4096) throw new Error('Too many CPUs');
    }
    return [...ids].sort((a, b) => a - b);
}
export type CpuCore = { socketId: number; coreId: number; cpuIds: number[] };
export async function readCpuTopology(root = '/sys/devices/system/cpu') {
    const availableCpuIds = parseCpuList(await readFile(`${root}/online`, 'utf8'));
    const groups = new Map<string, CpuCore>();
    await Promise.all(availableCpuIds.map(async id => {
        const path = `${root}/cpu${id}/topology`;
        const [socket, core, siblings] = await Promise.all(['physical_package_id', 'core_id', 'thread_siblings_list'].map(file => readFile(`${path}/${file}`, 'utf8')));
        const socketId = Number(socket.trim()), coreId = Number(core.trim());
        if (!Number.isInteger(socketId) || socketId < 0 || !Number.isInteger(coreId) || coreId < 0 || !parseCpuList(siblings).includes(id)) throw new Error('CPU topology unavailable');
        const key = `${socketId}:${coreId}`;
        const group = groups.get(key) ?? { socketId, coreId, cpuIds: [] };
        group.cpuIds.push(id); groups.set(key, group);
    }));
    const cores = [...groups.values()].sort((a, b) => a.socketId - b.socketId || a.coreId - b.coreId).map(c => ({ ...c, cpuIds: c.cpuIds.sort((a, b) => a - b) }));
    return { model: cpus()[0]?.model ?? 'CPU', availableCpuIds, cores, checkedAt: new Date().toISOString(), cpuBindingProtocol: 1 };
}
export function validateCpuBinding(limits: NormalizedResourceLimits, available: number[]) {
    if (!limits?.cpuSet?.length) return;
    const missing = limits.cpuSet.filter(id => !available.includes(id));
    if (missing.length) throw Object.assign(new Error(`CPU binding contains unavailable CPUs: ${missing.join(', ')}`), { statusCode: 400 });
    if (limits.cpu !== undefined && limits.cpu > limits.cpuSet.length) throw Object.assign(new Error(`vCPU limit cannot exceed ${limits.cpuSet.length} selected logical CPUs`), { statusCode: 400 });
}
export async function assertCpuBinding(limits: NormalizedResourceLimits) {
    if (!limits?.cpuSet?.length) return;
    let topology;
    try { topology = await readCpuTopology(); }
    catch { throw Object.assign(new Error('Cannot verify CPU topology on this node; CPU binding was not applied'), { statusCode: 503 }); }
    validateCpuBinding(limits, topology.availableCpuIds);
}
