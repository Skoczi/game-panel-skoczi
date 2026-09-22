import { ExternalBackupStore } from './externalBackupStore.js';

// Network filesystems can stall in the kernel. Keep all external-storage I/O
// out of the API process and terminate the worker when its deadline expires.
async function main() {
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Backup request is too large');
  }
  const request = JSON.parse(input);
  const store = new ExternalBackupStore(request.root);
  let result: unknown;
  if (request.action === 'list') {
    result = (await store.list(request.runtimeUuid)).map(({ server: _, ...record }) => record);
  } else if (request.action === 'publish') {
    result = await store.publish(request.input);
  } else if (request.action === 'import') {
    result = await store.importArchive(request.runtimeUuid, request.name, request.localDirectory);
  } else throw new Error('Unknown external backup action');
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : 'External backup failed' }));
  process.exitCode = 1;
}
}
void main();
