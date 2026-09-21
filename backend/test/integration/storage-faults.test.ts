// Opt-in only inside the privileged, disposable acceptance container.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { atomicFileWrite, fileVersion } from '../../src/services/atomicFile.js';

const enabled = process.env.GAMEPANEL_STORAGE_FAULT_TEST === '1';

test('Linux ENOSPC leaves the original atomic file and removes partial writes', { skip: !enabled }, async () => {
  assert.equal(process.platform, 'linux');
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'gp-full-'));
  let mounted = false;
  try {
    execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=1m', 'tmpfs', dir]); mounted = true;
    const file = path.join(dir, 'server.cfg');
    await fs.writeFile(file, 'original');
    await assert.rejects(atomicFileWrite(file, 'x'.repeat(2 * 1024 * 1024), fileVersion('original')), (error: any) => error.code === 'ENOSPC');
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['server.cfg']);
    await atomicFileWrite(file, 'retry succeeds', fileVersion('original'));
    assert.equal(await fs.readFile(file, 'utf8'), 'retry succeeds');
  } finally {
    if (mounted) execFileSync('umount', [dir]);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('Linux unprivileged writer cannot replace a protected file or change its owner', { skip: !enabled }, async () => {
  assert.equal(process.platform, 'linux');
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'gp-permissions-'));
  try {
    await fs.chmod(dir, 0o755);
    const file = path.join(dir, 'server.cfg');
    await fs.writeFile(file, 'original', { mode: 0o644 });
    const source = `
      import { atomicFileWrite, fileVersion } from './src/services/atomicFile.ts';
      try { await atomicFileWrite(${JSON.stringify(file)}, 'overwrite', fileVersion('original')); process.exit(2); }
      catch (error) { if (error.code !== 'EACCES') throw error; }
    `;
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { uid: 101, gid: 101 });
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.equal((await fs.stat(file)).uid, 0);
    assert.deepEqual(await fs.readdir(dir), ['server.cfg']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Linux extraction process killed after replacing a file recovers the original tree', { skip: !enabled }, async () => {
  assert.equal(process.platform, 'linux');
  const appRoot = await fs.mkdtemp(path.join(tmpdir(), 'gp-extraction-crash-'));
  const root = path.join(appRoot, 'servers/1');
  const destination = path.join(root, 'data');
  const staging = path.join(root, '.staging');
  try {
    await fs.mkdir(destination, { recursive: true }); await fs.mkdir(staging);
    await fs.writeFile(path.join(destination, 'a.cfg'), 'original');
    await fs.writeFile(path.join(staging, 'a.cfg'), 'replacement');
    await fs.writeFile(path.join(staging, 'b.cfg'), 'new file');
    const env = { ...process.env, GAMEPANEL_APP_ROOT: appRoot, DOMAIN: 'acceptance.invalid', PORT: '3001', JWT_SECRET: 'acceptance-only-nonproduction-secret-00000000' };
    const source = `
      import { promises as fs } from 'node:fs';
      const rename = fs.rename.bind(fs);
      fs.rename = async (from, to) => { await rename(from, to); if (to === ${JSON.stringify(path.join(destination, 'a.cfg'))}) process.kill(process.pid, 'SIGKILL'); };
      const { commitExtractedTree } = await import('./src/services/extractionTransaction.ts');
      await commitExtractedTree(1, ${JSON.stringify(staging)}, ${JSON.stringify(destination)}, true);
      process.exit(2);
    `;
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { env }), (error: any) => error.signal === 'SIGKILL');
    assert.equal(await fs.readFile(path.join(destination, 'a.cfg'), 'utf8'), 'replacement');
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "const { recoverExtraction } = await import('./src/services/extractionTransaction.ts'); await recoverExtraction(1); await recoverExtraction(1);"], { env });
    assert.equal(await fs.readFile(path.join(destination, 'a.cfg'), 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(destination), ['a.cfg']);
  } finally { await fs.rm(appRoot, { recursive: true, force: true }); }
});
