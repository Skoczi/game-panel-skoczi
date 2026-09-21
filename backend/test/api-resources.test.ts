import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceDto } from '../src/services/apiResourceDto.js';
import { getServerResourceSnapshot, setServerMetricsSample, retainServerMetricsSamples } from '../src/utils/serverMetricsCache.js';
test('public resource DTO excludes host percentages and secrets, preserves absolute units and unknowns', () => {
    const observedAt = new Date().toISOString();
    const data = resourceDto({ observedAt, resources: {
        cpuCores: 1.5, cpuLimitCores: 2, cpuLimitPercent: 75,
        memoryBytes: 1000, memoryLimitBytes: 2000, memoryLimitPercent: 50,
        diskBytes: -1, nodeFreeBytes: 1000000, cpuUsage: 12, password: 'secret',
    } });
    assert.equal(data.resources?.cpuCores, 1.5);
    assert.equal(data.resources?.memoryBytes, 1000);
    assert.equal(data.resources?.diskBytes, null);
    assert(!JSON.stringify(data).includes('nodeFreeBytes'));
    assert(!JSON.stringify(data).includes('cpuUsage'));
    assert(!JSON.stringify(data).includes('secret'));
    assert.deepEqual(resourceDto({ resources: null }), { observedAt: null, resources: null });
    assert.deepEqual(resourceDto({ observedAt: '2020-01-01T00:00:00Z', resources: {} }), { observedAt: null, resources: null });
    assert.throws(() => resourceDto({}));
    assert.throws(() => resourceDto({ observedAt: 'bad', resources: {} }));
});
test('resource snapshot follows the existing cache and never fabricates a stopped server measurement', () => {
    retainServerMetricsSamples([]);
    assert.deepEqual(getServerResourceSnapshot(9), { observedAt: null, resources: null });
    setServerMetricsSample(9, { cpuUsage: 20, memoryUsage: 10, diskUsage: 1, network: { in: 0, out: 0 },
        resources: { cpuCores: 0.5, cpuLimitCores: 1, cpuLimitPercent: 50, memoryBytes: 100, memoryLimitBytes: 200, memoryLimitPercent: 50 } });
    assert.equal(getServerResourceSnapshot(9).resources?.cpuCores, 0.5);
    assert(Number.isFinite(Date.parse(getServerResourceSnapshot(9).observedAt!)));
    retainServerMetricsSamples([]);
    assert.deepEqual(getServerResourceSnapshot(9), { observedAt: null, resources: null });
});
