import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateResources } from '../src/utils/docker/resources.js';
test('resources report cores and assigned limits rather than host percentages', () => {
 const stats = { cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 16 }, precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 }, memory_stats: { usage: 512, stats: { cache: 128, inactive_file: 64 } } };
 const result = calculateResources(stats, { NanoCpus: 2e9, Memory: 1024 });
 assert.equal(result.cpuCores, 1.6); assert.equal(result.cpuLimitPercent, 80);
 assert.equal(result.memoryBytes, 448); assert.equal(result.memoryLimitPercent, 43.75);
 assert.equal(calculateResources(stats, {}).memoryLimitPercent, null);
 assert.equal(calculateResources({}, {}).cpuCores, null);
 assert.equal(calculateResources(stats, { CpusetCpus: '0-1,4', CpuQuota: 50000, CpuPeriod: 100000 }).cpuLimitCores, 0.5);
});
