import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadWithMocks} from './loadWithMocks.js';
import * as cron from '../src/utils/cron.js';
function fixture() {
 const calls:string[]=[],outcomes:string[]=[];let fail=false,status='running';
 const server={id:1,provider:'linuxgsm',docker_container_id:'game',provider_metadata_json:'{}'};
 const row={id:1,server_id:1,type:'game_command',enabled:1,schedule:'* * * * *',payload_json:JSON.stringify({command:'say hello',pre:[{type:'game_command',command:'before'}],post:[{type:'game_command',command:'after'}],cleanup:[{type:'game_command',command:'cleanup'}]})};
 const scheduler=loadWithMocks('../src/services/scheduledTasks.ts',{
  './serverReconfiguration.js':{},'./panelMaintenance.js':{isPanelMaintenance:()=>false},'./nativeBackups.js':{nativeServerTemplate:()=>null},
  '../database/index.js':{serverRepository:{findById:async()=>server},actionsRepository:{create:async()=>{}},scheduledTaskRepository:{listDue:async()=>[row],lock:async()=>true,findById:async()=>row,finish:async(_id:number,v:any)=>outcomes.push(v.lastStatus)}},
  './nativeOperationLock.js':{enterServerMutation:()=>()=>{}},'../providers/serverMetadata.js':{getRuntimeConfig:()=>({execUser:"1000"})},'../utils/cron.js':cron,'../utils/json.js':{parseJsonObject:JSON.parse},'../utils/logger.js':{logError:()=>{}},'../utils/time.js':{nowIso:()=>new Date().toISOString()},
  '../utils/docker.js':{checkContainerStatus:async()=>status,execInContainer:async(_id:string,args:string[])=>{calls.push('shell:'+args.join(' '));return {exitCode:0};}},
  './serverBackups.js':{},'./gameConsole.js':{sendGameConsoleCommand:async(_server:unknown,c:string)=>{calls.push(c);return {ok:!(fail&&c==='say hello'),exitCode:1,stderr:'rejected'};}},'./serverTransitions.js':{},'./ovhcloudLifecycle.js':{},
 });return {scheduler,row,calls,outcomes,fail:()=>{fail=true;},stop:()=>{status='exited';}};
}
test('console task uses game transport and pre/post/cleanup in order',async()=>{const f=fixture();await f.scheduler.runDueScheduledTasks();assert.deepEqual(f.calls,['before','say hello','after','cleanup']);assert.deepEqual(f.outcomes,['success']);});
test('failed game command skips post but runs cleanup',async()=>{const f=fixture();f.fail();await f.scheduler.runDueScheduledTasks();assert.deepEqual(f.calls,['before','say hello','cleanup']);assert.deepEqual(f.outcomes,['failed']);});
test('stopped games skip commands',async()=>{const f=fixture();f.stop();await f.scheduler.runDueScheduledTasks();assert.deepEqual(f.calls,[]);assert.deepEqual(f.outcomes,['skipped']);});
test('custom still uses container shell',async()=>{const f=fixture();f.row.type='custom';f.row.payload_json=JSON.stringify({command:'echo hello'});await f.scheduler.runDueScheduledTasks();assert.deepEqual(f.calls,['shell:sh -lc echo hello']);assert.deepEqual(f.outcomes,['success']);});
