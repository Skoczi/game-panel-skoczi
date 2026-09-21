import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadWithMocks } from './loadWithMocks.js';
import * as validation from '../src/utils/httpValidation.js';
import { PERMISSIONS } from '../src/permissions.js';

test('Native backup routes return 202 and authorize status by the operation permission', async () => {
  const jobs: any[] = [];
  const router = loadWithMocks('../src/routes/backups.ts', {
    express: { Router: express.Router },
    '../services/backupCompatibility.js': {},
    '../services/backupListing.js': {},
    '../services/nativeRetention.js': {},
    '../services/nativeProtection.js': { inspectNativeProtection: async () => ({ archiveCount: 1 }) },
    '../utils/storage.js': { getServerStoragePaths: () => ({ dataDir: '/test' }) },
    '../services/backupJobs.js': {
      startBackupJob: async (_id: number, kind: string) => { const job={id:'operation',kind,status:'running'};jobs.push(job);return job; },
      listBackupJobs: async()=>jobs,
      readBackupJob: async()=>jobs[0],
    },
    '../services/nativeBackups.js': {nativeServerTemplate:()=>({}),normalizeBackupName:(name:unknown)=>name,createNativeBackup:()=>{throw new Error('Must run in the background');}},
    '../services/nativeRestore.js': {restoreNativeBackup:()=>{throw new Error('Must run in the background');}},
    '../middleware/auth.js': {requireServerPermission:(permission:string)=>(req:any,res:any,next:any)=>req.headers['x-test-permission']===permission?next():res.status(403).json({error:'denied'})},
    '../services/backupSettings.js':{},'../services/fileExplorer.js':{},'../utils/fsBrowser.js':{},'node:fs':{promises:fs},'node:path':path,
    '../services/servers.js':{getServerOrThrow:async()=>({id:7,docker_container_id:'test'})},
    '../database/index.js':{actionsRepository:{create:async()=>{}},scheduledTaskRepository:{listForServer:async()=>[{type:'custom',payload_json:'secret',enabled:1},{type:'backup',enabled:1,next_run_at:'2026-09-22T00:00:00Z',last_status:'failed'}]}},
    '../utils/routeErrors.js':{sendRouteError:(res:any,error:any)=>res.status(error.statusCode||500).json({error:error.message})},
    '../utils/httpValidation.js':validation,'../services/serverBackups.js':{},'../services/fileTransfers.js':{},'../permissions.js':{PERMISSIONS},
  }).default;
  const app=express();app.use(express.json());app.use('/servers/:id/backups',router);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/servers/7/backups`;
  try {
    const cleanupDenied = await fetch(url+'/retention?keepArchives=1&keepRecovery=1',{headers:{'x-test-permission':'backups.read'}}); assert.equal(cleanupDenied.status,403);
    const summaryDenied = await fetch(url+'/protection'); assert.equal(summaryDenied.status,403);
    const summary = await fetch(url+'/protection',{headers:{'x-test-permission':'backups.read'}}); assert.equal(summary.status,200); const info = await summary.json(); assert.equal(info.schedules.enabled,1); assert.equal(info.schedules.lastProblem,1); assert.equal(JSON.stringify(info).includes('secret'),false);
    const denied=await fetch(url+'/create',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(denied.status,403);assert.equal(jobs.length,0);
    const accepted=await fetch(url+'/create',{method:'POST',headers:{'content-type':'application/json','x-test-permission':'backups.create'},body:JSON.stringify({name:'Before update'})});
    assert.equal(accepted.status,202);assert.equal((await accepted.json()).job.status,'running');
    const status=await fetch(url+'/jobs/operation',{headers:{'x-test-permission':'backups.create'}});assert.equal(status.status,200);
    const list=await fetch(url+'/jobs',{headers:{'x-test-permission':'backups.create'}});assert.equal(list.status,403);
    const wrongPermission=await fetch(url+'/jobs/operation',{headers:{'x-test-permission':'backups.restore'}});assert.equal(wrongPermission.status,403);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
