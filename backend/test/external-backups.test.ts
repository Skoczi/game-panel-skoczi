import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import tar from 'tar-stream';
import { gzipSync } from 'node:zlib';
import { ExternalBackupStore, requireExternalFilesystem } from '../src/services/externalBackupStore.js';

test('external copies are atomically published, hashed, isolated by runtime and imported without overwrite', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-external-'));
  try {
    const store = new ExternalBackupStore(root, async () => {});
    const id = randomUUID(), source = path.join(root, 'source'), local = path.join(root, 'local');
    const pack = tar.pack();
    pack.entry({ name: 'serverfiles', type: 'directory' });
    pack.entry({ name: 'serverfiles/server.cfg', type: 'file' }, 'game files'); pack.finalize();
    const chunks: Buffer[] = []; for await (const chunk of pack) chunks.push(chunk);
    const archive = gzipSync(Buffer.concat(chunks));
    await fs.writeFile(source, archive); await fs.mkdir(local);
    const name = 'native-test.tar.gz';
    await store.publish({ runtimeUuid: id, name, archive: source, mode: 'live', server: { name: 'FFA', environment: { TOKEN: 'private' } }, keep: 7 });
    const list = await store.list(id); assert.equal(list.length, 1); assert.equal(list[0].sizeBytes, archive.length); assert.equal(list[0].sha256.length, 64);
    assert.equal((await store.list(randomUUID())).length, 0);
    await store.importArchive(id, name, local);
    assert.deepEqual(await fs.readFile(path.join(local, name)), archive);
    await assert.rejects(store.importArchive(id, name, local), /EEXIST/);
    assert.deepEqual(await fs.readFile(path.join(local, name)), archive);
    await assert.rejects(store.publish({ runtimeUuid: id, name, archive: source, mode: 'live', server: {}, keep: 7 }), /already exists/);
    await assert.rejects(store.importArchive(id, '../escape.tar.gz', local), /Invalid external/);
    await assert.rejects(store.list('../escape'), /identity/);
    const corrupt = Buffer.from(archive); corrupt[0] ^= 0xff;
    await fs.writeFile(path.join(root, 'gamepanel-v1', id, name, 'archive.tar.gz'), corrupt);
    const elsewhere = path.join(root, 'elsewhere'); await fs.mkdir(elsewhere);
    await assert.rejects(store.importArchive(id, name, elsewhere), /checksum/);
    assert.equal((await fs.readdir(elsewhere)).length, 0);
    await fs.writeFile(source, 'invalid tar with a valid checksum');
    await store.publish({ runtimeUuid: id, name: 'native-invalid.tar.gz', archive: source, mode: 'live', server: {}, keep: null });
    await assert.rejects(store.importArchive(id, 'native-invalid.tar.gz', elsewhere));
    assert.equal((await fs.readdir(elsewhere)).length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('external retention preserves unknown and partial copies; failed transfer does not prune', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-external-retention-'));
  try {
    const store = new ExternalBackupStore(root, async () => {});
    const id = randomUUID(), source = path.join(root, 'source'); await fs.writeFile(source, 'archive');
    for (let i = 0; i < 3; i++) await store.publish({ runtimeUuid: id, name: `native-${i}.tar.gz`, archive: source, mode: 'offline', server: {}, keep: 2 });
    assert.equal((await store.list(id)).length, 2);
    const dir = await store.directory(id);
    await fs.mkdir(path.join(dir, 'native-unknown.tar.gz')); await fs.mkdir(path.join(dir, '.partial-existing'));
    await assert.rejects(store.publish({ runtimeUuid: id, name: 'native-failed.tar.gz', archive: source + '-missing', mode: 'offline', server: {}, keep: 1 }));
    assert.equal((await store.list(id)).length, 2);
    await store.publish({ runtimeUuid: id, name: 'native-new.tar.gz', archive: source, mode: 'offline', server: {}, keep: 1 });
    assert.deepEqual((await store.list(id)).map(r => r.name), ['native-new.tar.gz']);
    assert(await fs.stat(path.join(dir, '.partial-existing'))); assert(await fs.stat(path.join(dir, 'native-unknown.tar.gz')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('an unavailable external mount cannot fall back to the local node disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-external-missing-'));
  try {
    await assert.rejects(requireExternalFilesystem(root));
    await assert.rejects(new ExternalBackupStore(root).list(randomUUID()));
    assert.equal((await fs.readdir(root)).length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
