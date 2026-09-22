import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCpuList, readCpuTopology, validateCpuBinding } from '../src/services/cpuTopology.js';
import { normalizeResourceLimitsPayload, mergeResourceLimitsBinding, resourceLimitsToDockerHostConfig, resourceLimitsToDockerUpdatePayload } from '../src/utils/resourceLimits.js';
import { loadWithMocks } from './loadWithMocks.js';

test('binding normalization, independent quota/memory, old client preservation and explicit clear', () => {
    const initial = normalizeResourceLimitsPayload({ cpu: 1, memoryMb: 1024, cpuSet: [14, 6, 6] });
    assert.deepEqual(initial, { cpu: 1, memoryMb: 1024, cpuSet: [6, 14] });
    assert.deepEqual(resourceLimitsToDockerHostConfig(initial), { Memory: 1073741824, NanoCpus: 1e9, CpusetCpus: '6,14' });
    assert.deepEqual(mergeResourceLimitsBinding({ cpu: 0.5 }, initial), { cpu: 0.5, cpuSet: [6, 14] });
    assert.deepEqual(mergeResourceLimitsBinding(null, initial), { cpuSet: [6, 14] });
    assert.deepEqual(mergeResourceLimitsBinding({ memoryMb: 2048, cpuSet: [] }, initial), { memoryMb: 2048 });
    assert.equal(resourceLimitsToDockerUpdatePayload(mergeResourceLimitsBinding({ cpuSet: [] }, initial)).CpusetCpus, '');
    assert.deepEqual(resourceLimitsToDockerHostConfig(normalizeResourceLimitsPayload({ cpuSet: [6,14] })), { CpusetCpus: '6,14' });
    for (const cpuSet of [[-1], [1.2], ['1'], [65536], '6,14', null]) assert.throws(() => normalizeResourceLimitsPayload({ cpuSet }));
});
test('unavailable CPUs and quota beyond selected threads are rejected; shared selections allowed', () => {
    assert.deepEqual(parseCpuList('0-3,2,8-9'), [0,1,2,3,8,9]);
    for (const input of ['-1','3-1','0-999999','1,,2','1; echo x']) assert.throws(() => parseCpuList(input));
    assert.throws(() => validateCpuBinding({ cpuSet: [6,14] }, [0,1]), /unavailable/);
    assert.throws(() => validateCpuBinding({ cpu: 3, cpuSet: [6,14] }, [6,14]), /cannot exceed/);
    for (let server = 0; server < 2; server++) assert.doesNotThrow(() => validateCpuBinding({ cpu: 1, cpuSet: [6,14] }, [6,14]));
});
for (const count of [4,6,8]) test(`detects real ${count}-core SMT numbering from sysfs`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'gp-cpu-'));
    try {
        await writeFile(join(root, 'online'), `0-${count*2-1}`);
        for (let id=0; id<count*2; id++) {
            const dir = join(root, `cpu${id}`, 'topology'); await mkdir(dir, {recursive:true});
            await Promise.all(Object.entries({physical_package_id:'0', core_id:String(id%count), thread_siblings_list:`${id%count},${id%count+count}`}).map(([name,v])=>writeFile(join(dir,name),v)));
        }
        const result = await readCpuTopology(root);
        assert.equal(result.cores.length,count);
        assert.deepEqual(result.cores[0].cpuIds,[0,count]);
        assert.deepEqual(result.cores[count-1].cpuIds,[count-1,count*2-1]);
        await writeFile(join(root,'online'), `0-${count-1}`);
        assert.ok((await readCpuTopology(root)).cores.every(c=>c.cpuIds.length===1));
    } finally { await rm(root,{recursive:true,force:true}); }
});
test('assignment inventory preserves stopped/pending servers, includes external containers, counts unbound running', async () => {
    const module = loadWithMocks('../src/services/cpuAssignments.ts', {
        '../database/index.js': {serverRepository:{listAll:async()=>[{id:7,name:'BoB',docker_container_id:'bob',resource_limits_json:'{"cpuSet":[0,2]}',provider_metadata_json:'{"pendingConfiguration":{"hasResourceLimitsPatch":true,"resourceLimits":{"cpuSet":[1,3]}}}'}]}},
        '../utils/resourceLimits.js':{parseStoredResourceLimits:(s:any)=>JSON.parse(s.resource_limits_json)},
        './cpuTopology.js':{readCpuTopology:async()=>({availableCpuIds:[0,1,2,3]}),parseCpuList},
        '../utils/docker/client.js':{docker:{info:async()=>({NCPU:4}),listContainers:async()=>[{Id:'bob'},{Id:'ptero'},{Id:'system'}],getContainer:(id:string)=>({inspect:async()=>({Id:id,Name:`/${id}`,State:{Status:id==='bob'?'exited':'running'},HostConfig:{CpusetCpus:id==='system'?'':'0,2'}})})}},
    });
    const data = await module.availableCpus();
    assert.equal(data.assignments.length,3); assert.equal(data.unboundContainerCount,1);
    assert.deepEqual(Array.from(data.assignments[0].pendingCpuSet),[1,3]); assert.equal(data.assignments[0].state,'exited');
    assert.equal(data.assignments[1].source,'external');
    const external = { Id: '123456789abc', Name: '/620475c4-ea82-478c-98d4-7d9e93093a78', Config: { Labels: { Service: 'Pterodactyl' }, Env: ['HOSTNAME=OnlyDD2 ^ CSCO.PL', 'SERVER_PORT=27015', 'STEAM_ACC=never-display-this'] } };
    assert.equal(module.externalContainerName(external), 'OnlyDD2 ^ CSCO.PL · :27015');
    assert.equal(module.externalContainerName({ ...external, Config: { ...external.Config, Env: ['SERVER_PORT=27015'] } }), 'Pterodactyl 620475c4 · :27015');
    assert.equal(module.externalContainerName({ ...external, Config: { ...external.Config, Env: ['HOSTNAME=123456789abc', 'SERVER_PORT=99999'] } }), 'Pterodactyl 620475c4');
    assert.equal(module.externalContainerName({ ...external, Name: '/postgres', Config: { Env: ['HOSTNAME=123456789abc'] } }), 'postgres');
});
