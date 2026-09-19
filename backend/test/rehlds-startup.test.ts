import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('ReHLDS startup applies the managed hostname after owner config and rejects command injection', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rehlds-start-'));
    const source = await fs.readFile(new URL('../../runtime/rehlds/start.sh', import.meta.url), 'utf8');
    const script = source.replace('cd /data/serverfiles', 'cd "$TEST_ROOT"');
    const env = { ...process.env, TEST_ROOT: root, SERVER_NAME: '[PL] Native test @ eserv.pl', MAP: 'de_dust2', MAX_PLAYERS: '16' };
    try {
        await fs.mkdir(path.join(root, 'cstrike'));
        await fs.writeFile(path.join(root, 'cstrike/server.cfg'), 'hostname old\n');
        await fs.writeFile(path.join(root, 'hlds_linux'), '#!/bin/bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
        const result = await promisify(execFile)('bash', ['-c', script, 'hlds', '-console', '+map', 'de_dust2'], { env });
        assert.equal(result.stdout, '-console\n+map\nde_dust2\n');
        assert.equal(await fs.readFile(path.join(root, 'cstrike/gamepanel-startup.cfg'), 'utf8'), 'exec server.cfg\nhostname "[PL] Native test @ eserv.pl"\n');
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), 'hostname old\n');
        for (const SERVER_NAME of ['bad"quit', 'bad;quit', 'bad\nquit', 'bad\\quit', 'bad\rquit']) {
            await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, SERVER_NAME } }));
        }
        await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, MAX_PLAYERS: '99' } }));
        await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, MAP: '../bad' } }));
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
