import { withStorageReserve } from '../src/services/storageReserve.js';
import { validateNativeArchive } from '../src/services/nativeArchive.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { loadWithMocks } from './loadWithMocks.js';
import * as cron from '../src/utils/cron.js';

test('scheduler executes the real Native backup for stopped and running servers', async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-schedule-'));
 let status = 'exited'; const outcomes: string[] = []; let failBackup = false; const commands: string[] = [];
 const server = { id: 1, docker_container_id: 'game', provider_metadata_json: '{}' };
 const native = loadWithMocks('../src/services/nativeBackups.ts', {
  './nativeProtection.js': { recordNativeBackup: async () => ({}) },
        './storageReserve.js': { withStorageReserve },
        './nativeRestoreJournal.js': { syncDirectory: async () => {} },
        './nativeArchive.js': { validateNativeArchive },
        'node:fs': { promises: fs }, 'node:path': path, 'node:child_process': { execFile }, 'node:util': { promisify }, 'node:crypto': { randomUUID },
  '../templates/nativeContract.js': { nativeTemplate: () => ({ mounts: [{ key: 'data' }] }) },
  '../utils/storage.js': { getServerStoragePaths: () => ({ serverRoot: root }) },
  '../utils/docker.js': { checkContainerStatus: async () => status }, './nativeOperationLock.js': { acquireNativeOperation: () => () => {} },
 }, { process, Buffer });
 const row = { id: 1, server_id: 1, type: 'backup', enabled: 1, schedule: '0 5 * * *', payload_json: '{}' };
 const scheduler = loadWithMocks('../src/services/scheduledTasks.ts', {
  './nativeBackups.js': native,
  '../database/index.js': { serverRepository: { findById: async () => server }, actionsRepository: { create: async () => {} }, scheduledTaskRepository: { listDue: async () => [row], lock: async () => true, findById: async () => row, finish: async (_id: number, value: any) => outcomes.push(value.lastStatus) } },
  './nativeOperationLock.js': { enterServerMutation: () => () => {} }, '../providers/serverMetadata.js': {}, '../utils/cron.js': cron,
  '../utils/json.js': { parseJsonObject: JSON.parse }, '../utils/logger.js': { logError: () => {} }, '../utils/time.js': { nowIso: () => new Date().toISOString() },
  '../utils/docker.js': { checkContainerStatus: async () => status }, './serverBackups.js': { createServerBackup: async (server: any) => { if(failBackup) throw new Error('simulated disk failure'); return native.createNativeBackup(server); } }, './gameConsole.js': {sendGameConsoleCommand: async (_server: any, command: string) => { commands.push(command); return {ok:true}; }}, './serverTransitions.js': {}, './ovhcloudLifecycle.js': {},
 });
 try {
  await fs.mkdir(path.join(root, 'data', 'serverfiles'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'serverfiles', 'world'), 'world');
  await scheduler.runDueScheduledTasks(); status = 'running'; await scheduler.runDueScheduledTasks();
  assert.deepEqual(outcomes, ['success', 'success']);
  assert.equal((await fs.readdir(path.join(root, 'data', 'backups'))).length, 2);
  failBackup = true; row.payload_json = JSON.stringify({pre:[{type:'game_command',command:'save-off'}],post:[{type:'game_command',command:'success-only'}],cleanup:[{type:'game_command',command:'save-on'}]});
  await scheduler.runDueScheduledTasks();
  assert.deepEqual(commands,['save-off','save-on']); assert.equal(outcomes[2],'failed');
 } finally { await fs.rm(root, { recursive: true, force: true }); }
});
