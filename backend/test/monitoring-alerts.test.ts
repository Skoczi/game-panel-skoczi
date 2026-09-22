import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { MONITORING_ALERTS_SQL } from '../src/database/migrations/0007_monitoring_alerts.js';
import { AlertStore, validateAlertBatch, webhookUrl, type AlertEvent } from '../src/services/alertStore.js';
import { deliverDiscord } from '../src/services/discordAlerts.js';
import { loadWithMocks } from './loadWithMocks.js';
const hook = 'https://discord.com/api/webhooks/123456789012345678/' + 'a'.repeat(64);
function database(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
    db.exec('CREATE TABLE game_servers(id INTEGER PRIMARY KEY); INSERT INTO game_servers(id) VALUES(7);'+MONITORING_ALERTS_SQL);
    const adapter = { get: async (s:string,...a:any[])=>db.prepare(s).get(...a), all: async(s:string,...a:any[])=>db.prepare(s).all(...a),run:async(s:string,...a:any[])=>db.prepare(s).run(...a) };
    return { db, adapter, store: new AlertStore(adapter as any) };
}
const event = (): AlertEvent => ({ id:randomUUID(),category:'game',title:'Game is not responding',detail:'Test server',createdAt:Date.now() });
test('notification settings hide webhook, reject stale writes and skip disabled backlog', async t=>{
    const {store}=database(t);
    const first=await store.view(); assert.equal(first.enabled,false);
    await store.enqueue(event(),'local'); assert.equal(await store.next(),undefined);
    const saved=await store.save({revision:0,enabled:true,webhook:hook,categories:['game']});
    assert.equal(saved.webhookConfigured,true); assert.equal('webhook' in saved,false);
    await assert.rejects(store.save({revision:0,enabled:false,categories:[]}),/changed/);
    await store.save({revision:1,enabled:true,categories:['game']}); assert.equal((await store.config()).webhook,hook);
    await store.enqueue(event(),'local'); assert.ok(await store.next());
    await store.save({revision:2,enabled:false,categories:['game']}); assert.equal(await store.next(),undefined);
    assert.throws(()=>webhookUrl('https://discord.com.evil.test/api/webhooks/1/token'));
    assert.throws(()=>webhookUrl(hook+'?wait=false'));
});
test('agent retry uses stable IDs, central dedup survives lost acknowledgment, category filters apply',async t=>{
    const {store,db}=database(t);
    await store.save({revision:0,enabled:true,webhook:hook,categories:['game']});
    const e=event(); await store.enqueue(e,'agent-outbox');
    assert.equal((await store.outbox()).length,1);
    await store.receive('node-1','Warsaw',[e]); await store.receive('node-1','Warsaw',[e]);
    assert.equal(db.prepare("SELECT count(*) n FROM alert_events WHERE source='node-1'").get()!.n,1);
    await store.acknowledge([e.id]); assert.equal((await store.outbox()).length,0);
    await store.receive('node-1','Warsaw',[{...event(),category:'backup'}]);
    assert.equal(db.prepare("SELECT state FROM alert_events WHERE category='backup'").get()!.state,'skipped');
    assert.throws(()=>validateAlertBatch([{...e,createdAt:Date.now()-90000000}]),/Invalid/);
});
test('node outage creates one incident and one recovery, disabled nodes reset baseline', async t=>{
    const {store,db}=database(t);
    await store.nodeState('node','Warsaw',false,1000); await store.nodeState('node','Warsaw',true,2000); await store.nodeState('node','Warsaw',true,3000); await store.nodeState('node','Warsaw',false,4000);
    assert.equal(db.prepare('SELECT count(*) n FROM alert_events').get()!.n,2);
    await store.forgetNode('node'); await store.nodeState('node','Warsaw',false,5000);
    assert.equal(db.prepare('SELECT count(*) n FROM alert_events').get()!.n,2);
});
test('Discord confirms delivery, disables mentions, honors 429 and does not blindly retry uncertain delivery',async()=>{
    const e=event(); let body:any;
    const delivered=await deliverDiscord(hook,e,(async(url:any,init:any)=>{assert.equal(new URL(url).searchParams.get('wait'),'true');body=JSON.parse(init.body);return new Response('{}',{status:200});}) as any);
    assert.equal(delivered.state,'delivered'); assert.deepEqual(body.allowed_mentions,{parse:[]});
    const limited=await deliverDiscord(hook,e,(async()=>new Response('{"retry_after":12}',{status:429})) as any);
    assert.equal(limited.state,'pending'); assert.equal(limited.retrySeconds,12);
    assert.equal((await deliverDiscord(hook,e,(async()=>{throw new Error(hook);}) as any)).state,'unknown');
    assert.equal((await deliverDiscord(hook,e,(async()=>new Response('',{status:500})) as any)).state,'unknown');
    assert.equal((await deliverDiscord(hook,e,(async()=>new Response('',{status:404})) as any)).state,'failed');
});
test('interrupted sends retain uncertain state and are not replayed at startup',async t=>{
    const {store}=database(t);await store.save({revision:0,enabled:true,webhook:hook,categories:['game']});await store.enqueue(event(),'local');
    const row=await store.next();assert.equal(await store.claim(row.id),true);assert.equal(await store.claim(row.id),false);
    await store.recoverSending();assert.equal(await store.next(),undefined);assert.equal((await store.view()).recent[0].state,'unknown');
});
function recovery(t:any) {
    const {db,adapter}=database(t); let maintenance=false, busy=false, calls=0, crash=false;
    const server:any={id:7,name:'Test',desired_state:'running',status:'running',docker_container_id:'container'};
    const record:any={revision:1,config:{enabled:true,intervalSeconds:30,failureThreshold:3,autoRestart:{enabled:true,cooldownSeconds:60,maxAttempts:2,windowSeconds:900}},snapshot:{state:'offline',runtimeKey:'container:time',checkedAt:new Date().toISOString(),incidentStartedAt:new Date().toISOString(),failures:3}};
    const actions:string[]=[];
    const service=loadWithMocks('../src/services/monitoringRecovery.ts',{
        dockerode:class { getContainer(){return {inspect:async()=>({Id:'container',State:{Running:true,StartedAt:'time'},Config:{Labels:{}}})};} },
        '../config.js':{getConfig:()=>({dockerSocket:'/not-used'})},'../utils/docker/ownership.js':{ownsContainer:()=>true},
        'node:crypto':{randomUUID},'../database/init.js':{getDatabase:async()=>adapter},
        '../database/index.js':{serverRepository:{findById:async()=>server},actionsRepository:{create:async(_:number,__:string,m:string)=>actions.push(m)}},
        '../database/repositories/gameMonitoringRepository.js':{gameMonitoringRepository:{get:async()=>record}},
        './nativeOperationLock.js':{enterServerMutation:()=>{if(busy)throw new Error('Busy');busy=true;return()=>{busy=false;};}},
        './panelMaintenance.js':{isPanelMaintenance:()=>maintenance},
        './restartServer.js':{restartServer:async()=>{calls++;assert.equal(db.prepare("SELECT count(*) n FROM monitoring_restarts WHERE state='running'").get()!.n,1);if(crash)throw new Error('Docker timeout');}},
        './serverTransitions.js':{clearServerTransition:()=>{},reconcileServerStatus:async()=>{}},
    });
    return {service,db,server,record,actions,get calls(){return calls;},set busy(v:boolean){busy=v;},set maintenance(v:boolean){maintenance=v;},set crash(v:boolean){crash=v;}};
}
test('automatic recovery respects stopped, stale, unavailable, disabled, busy and maintenance states',async t=>{
    const f=recovery(t);
    for(const state of ['online','unavailable','maintenance','stopped','degraded']){f.record.snapshot.state=state;await f.service.maybeRestartGame(7,1,'container:time');}
    f.record.snapshot.state='offline';f.server.desired_state='stopped';await f.service.maybeRestartGame(7,1,'container:time');f.server.desired_state='running';
    f.busy=true;await f.service.maybeRestartGame(7,1,'container:time');f.busy=false;
    f.maintenance=true;await f.service.maybeRestartGame(7,1,'container:time');f.maintenance=false;
    f.record.config.autoRestart.enabled=false;await f.service.maybeRestartGame(7,1,'container:time');f.record.config.autoRestart.enabled=true;
    f.record.snapshot.checkedAt=new Date(0).toISOString();await f.service.maybeRestartGame(7,1,'container:time');
    assert.equal(f.calls,0);
});
test('automatic attempt is persisted before Docker, observes cooldown and durable window budget',async t=>{
    const f=recovery(t);await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,1);
    await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,1);
    f.db.prepare('UPDATE monitoring_restarts SET created_at=?').run(Date.now()-61000);
    await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,2);
    f.db.prepare('UPDATE monitoring_restarts SET created_at=?').run(Date.now()-61000);
    await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,2);
    assert.equal((await f.service.recoverySummary(7,f.record.config)).attemptsInWindow,2);
    f.record.config.autoRestart.enabled=false;f.record.config.autoRestart.enabled=true;
    await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,2);
});
test('failed and interrupted attempts consume limits, outdated config/runtime never trigger restart',async t=>{
    const f=recovery(t);await f.service.maybeRestartGame(7,2,'container:time');await f.service.maybeRestartGame(7,1,'old');assert.equal(f.calls,0);
    f.crash=true;await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,1);
    assert.equal(f.db.prepare('SELECT state FROM monitoring_restarts').get()!.state,'failed');
    f.db.prepare("UPDATE monitoring_restarts SET state='running'").run();await f.service.recoverRestartAttempts();
    assert.equal(f.db.prepare('SELECT state FROM monitoring_restarts').get()!.state,'unknown');
    await f.service.maybeRestartGame(7,1,'container:time');assert.equal(f.calls,1);
    assert.throws(()=>f.service.validateAutoRestart({enabled:true,cooldownSeconds:0,maxAttempts:99,windowSeconds:10}));
    assert.equal(f.service.validateAutoRestart(undefined).enabled,false);
});
