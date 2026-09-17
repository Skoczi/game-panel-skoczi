// Disposable Linux CI only: two separate runtime databases and real Docker containers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';

test('real central + agent: enroll, isolated install, HTTP/files/WS, replay, restart, offline and revocation', {
    skip: process.env.GAMEPANEL_NODE_DOCKER_TEST !== '1', timeout: 480000,
},async()=>{
    assert.equal(process.platform,'linux','Run only in the disposable Linux CI job');
    const root=mkdtempSync(path.join(tmpdir(),'gamepanel-node-ci-'));
    const suffix=randomUUID().slice(0,8), panelName=`gp-ci-panel-${suffix}`, agentName=`gp-ci-agent-${suffix}`;
    const image=process.env.GAMEPANEL_NODE_TEST_IMAGE || 'gamepanel-agent:ci';
    const password=randomBytes(24).toString('base64url'), master=randomBytes(48).toString('base64url');
    const panel='http://127.0.0.1:32181',agent='http://127.0.0.1:32182';
    let token='',nodeId='',gameContainer='';
    const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',timeout:120000});
    const request=async(url:string,method='GET',body?:unknown,key=randomUUID())=>{
        const response=await fetch(url,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
        const value=await response.json().catch(()=>null);return {status:response.status,value};
    };
    const ok=async(url:string,method='GET',body?:unknown,key?:string)=>{
        const result=await request(url,method,body,key);assert.ok(result.status<300,`${method} ${url}: ${result.status} ${JSON.stringify(result.value)}`);return result.value;
    };
    async function waitFor(check:()=>Promise<boolean>,name:string){for(let i=0;i<100;i++){try{if(await check())return;}catch{}await delay(500);}throw new Error(`Timed out: ${name}`);}
    const common=['--network','host','-e','GAMEPANEL_TEST_LOOPBACK_NODES=1','-e','DOMAIN=panel.example.com','-e',`JWT_SECRET=${master}`,'-e','ADMIN_USERNAME=ciadmin','-e',`ADMIN_PASSWORD=${password}`,'-e','TELEMETRY_ENABLED=false','-v','/var/run/docker.sock:/var/run/docker.sock'];
    let socket:WebSocket|undefined;
    try {
        for(const dir of ['panel-data','agent-data','agent-identity','panel-app/servers','agent-app/servers'])mkdirSync(path.join(root,dir),{recursive:true});
        docker('run','-d','--name',panelName,...common,'-e','PORT=32181','-e',`GAMEPANEL_APP_ROOT=${root}/panel-app`,'-e',`GAMEPANEL_GAMES_NETWORK=gp-ci-local-${suffix}`,'-v',`${root}/panel-data:/data`,'-v',`${root}/panel-app/servers:${root}/panel-app/servers`,image);
        await waitFor(async()=>(await fetch(panel+'/api/health')).ok,'central startup');
        token=(await ok(panel+'/api/auth/login','POST',{username:'ciadmin',password})).token;assert.ok(token);
        const created=await ok(panel+'/api/nodes','POST',{name:'CI agent',origin:agent});nodeId=created.node.id;
        const identity=await ok(panel+`/api/nodes/${nodeId}/enroll`,'POST',{token:created.enrollmentToken});
        assert.equal((await request(panel+`/api/nodes/${nodeId}/enroll`,'POST',{token:created.enrollmentToken})).status,401);
        writeFileSync(root+'/agent-identity/agent.json',JSON.stringify({...identity,panel}),{mode:0o600});
        docker('run','-d','--name',agentName,...common,'-e','PORT=32182','-e',`GAMEPANEL_APP_ROOT=${root}/agent-app`,'-e','GAMEPANEL_AGENT_CONFIG=/identity/agent.json','-e','GAMEPANEL_IP_PORTS={}','-v',`${root}/agent-data:/data`,'-v',`${root}/agent-identity:/identity:ro`,'-v',`${root}/agent-app/servers:${root}/agent-app/servers`,image);
        await waitFor(async()=>(await fetch(agent+'/api/health')).ok,'agent startup');
        assert.equal((await request(agent+'/api/servers')).status,401);
        assert.equal((await request(agent+'/api/auth/login','POST',{username:'ciadmin',password})).status,404);
        await waitFor(async()=>(await ok(panel+'/api/nodes')).nodes[0].status==='online','heartbeat');
        const runtime=panel+`/api/nodes/${nodeId}/runtime`;
        const settings=await ok(runtime+'/api/system/settings');
        assert.equal(settings.network.restrictPorts,true);
        await ok(runtime+'/api/system/settings','PUT',{revision:settings.revision,appearance:settings.appearance,network:{restrictPorts:true,allocations:[{ip:'127.0.0.1',alias:'CI',tcp:'32280',udp:''}]}});
        const spec={name:'CI remote nginx',provider:'external',dockerImage:'nginx:alpine',runtimeIdentity:{user:'root',uid:0,gid:0},mounts:[],ports:{tcp:[{host:32280,container:80,hostIp:'127.0.0.1'}],udp:[]}};
        const forbidden=await request(runtime+'/api/servers/install','POST',{...spec,ports:{tcp:[{host:8080,container:80,hostIp:'127.0.0.1'}],udp:[]}});
        assert.equal(forbidden.status,400);
        const operation=randomUUID();const installed=await ok(runtime+'/api/servers/install','POST',spec,operation);
        const id=installed.server.id;assert.ok(id);
        assert.equal((await ok(runtime+'/api/servers/install','POST',spec,operation)).server.id,id);
        assert.equal((await request(runtime+'/api/servers/install','POST',{...spec,name:'Different'},operation)).status,409);
        await waitFor(async()=>{const s=await ok(runtime+`/api/servers/${id}`);return (s.server||s).status==='running';},'game installation');
        const listed=await ok(runtime+'/api/servers');assert.ok(JSON.stringify(listed).includes('CI remote nginx'));
        assert.ok(!JSON.stringify(await ok(panel+'/api/servers')).includes('CI remote nginx'));
        gameContainer=docker('ps','-q','--filter',`label=gamepanel.node=${nodeId}`,'--filter',`label=gamepanel.serverId=${id}`).trim();assert.ok(gameContainer);
        await waitFor(async()=>(await fetch('http://127.0.0.1:32280')).ok,'published game port');
        await ok(runtime+`/api/servers/${id}/files/touch`,'POST',{path:'/agent-test.txt'});
        await ok(runtime+`/api/servers/${id}/file?path=%2Fagent-test.txt`,'PUT',{content:'remote file persists'});
        const content=await ok(runtime+`/api/servers/${id}/file?path=%2Fagent-test.txt`);assert.ok(JSON.stringify(content).includes('remote file persists'));
        const download=await ok(runtime+`/api/servers/${id}/files/download-token`,'POST',{path:'/agent-test.txt'});
        assert.match(download.path,/^\/api\/node-download\//);
        assert.equal(await (await fetch(panel+download.path)).text(),'remote file persists');
        assert.equal((await fetch(panel+download.path)).status,404);
        socket=new WebSocket(panel.replace('http:','ws:')+`/api/nodes/${nodeId}/ws`);
        const frames:any[]=[];socket.on('message',data=>frames.push(JSON.parse(data.toString())));
        socket.on('open',()=>socket!.send(JSON.stringify({type:'auth',token})));
        await waitFor(async()=>frames.some(f=>f.type==='auth:success'),'remote websocket authentication');
        socket.send(JSON.stringify({type:'subscribe:servers'}));
        await waitFor(async()=>frames.some(f=>f.type==='servers:snapshot'&&JSON.stringify(f).includes('CI remote nginx')),'remote websocket snapshot');
        await ok(runtime+`/api/servers/${id}/stop`,'POST');await ok(runtime+`/api/servers/${id}/start`,'POST');
        docker('restart',agentName);await waitFor(async()=>(await fetch(agent+'/api/health')).ok,'agent restart');
        assert.equal(JSON.parse(docker('inspect',gameContainer))[0].State.Running,true);
        assert.equal((await ok(runtime+'/api/operations/'+operation)).state,'completed');
        docker('stop',panelName);assert.equal(JSON.parse(docker('inspect',gameContainer))[0].State.Running,true);
        docker('start',panelName);await waitFor(async()=>(await fetch(panel+'/api/health')).ok,'panel restart');
        assert.equal((await ok(runtime+'/api/servers/install','POST',spec,operation)).server.id,id);
        docker('stop',agentName);assert.equal((await request(runtime+'/api/servers')).status,503);
        docker('start',agentName);await waitFor(async()=>(await fetch(agent+'/api/health')).ok,'agent reconnect');
        await ok(panel+`/api/nodes/${nodeId}`,'PATCH',{enabled:false});
        assert.equal((await request(runtime+'/api/servers')).status,503);
        assert.equal(JSON.parse(docker('inspect',gameContainer))[0].State.Running,true);
        await ok(panel+`/api/nodes/${nodeId}`,'PATCH',{enabled:true});
        await ok(panel+`/api/nodes/${nodeId}/credentials`,'POST',{});
        assert.equal((await request(runtime+'/api/servers')).status,503);
        console.log('Real node lifecycle, files, replay, WebSocket and outage checks passed');
    }catch(error){
        for(const name of [panelName,agentName])try{console.error(docker('logs','--tail','80',name));}catch{}
        throw error;
    }finally{
        socket?.terminate();
        for(const name of [panelName,agentName])try{docker('rm','-f',name);}catch{}
        if(nodeId){for(const id of docker('ps','-aq','--filter',`label=gamepanel.node=${nodeId}`).trim().split('\n').filter(Boolean))try{docker('rm','-f',id);}catch{}
            try{docker('network','rm',`gp-${nodeId}-games`);}catch{}}
        try{docker('network','rm',`gp-ci-local-${suffix}`);}catch{}
        // Only our mkdtemp-owned fixture, after all containers have stopped.
        try{rmSync(root,{recursive:true});}catch{console.warn('Fixture retained:',root);}
    }
});
