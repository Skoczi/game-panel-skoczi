import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateTemplate } from '../src/templates/schema.js';

test('ReHLDS startup updates hostname without replacing owner config and rejects command injection', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rehlds-start-'));
    const source = await fs.readFile(new URL('../../runtime/rehlds/start.sh', import.meta.url), 'utf8');
    const document = validateTemplate(JSON.parse(await fs.readFile(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8')));
    assert.equal(document.lifecycle!.startup[2], source);
    assert(document.lifecycle!.startup.indexOf('+servercfgfile') < document.lifecycle!.startup.indexOf('+map'));
    const script = source.replace('cd /data/serverfiles', 'cd "$TEST_ROOT"');
    const env = { ...process.env, TEST_ROOT: root, SERVER_NAME: '[PL] Native test @ eserv.pl', MAP: 'de_dust2', MAX_PLAYERS: '16', CFG: 'server.cfg' };
    try {
        await fs.mkdir(path.join(root, 'cstrike'));
        await fs.writeFile(path.join(root, 'cstrike/server.cfg'), '// keep\nsv_lan 0\nhostname old\nexec server.cfg\nhostname duplicate\n');
        await fs.writeFile(path.join(root, 'hlds_linux'), '#!/bin/bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
        const result = await promisify(execFile)('bash', ['-c', script, 'hlds', '-console', '+map', 'de_dust2'], { env });
        assert.equal(result.stdout, '-console\n+map\nde_dust2\n');
        const expected = '// keep\nsv_lan 0\nhostname "[PL] Native test @ eserv.pl"\n';
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), expected);
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg.bak'), 'utf8'), '// keep\nsv_lan 0\nhostname old\nexec server.cfg\nhostname duplicate\n');
        await assert.rejects(fs.stat(path.join(root, 'cstrike/gamepanel-startup.cfg')));
        await promisify(execFile)('bash', ['-c', script, 'hlds'], { env });
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), expected);
        await promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, CFG: 'custom.cfg', SERVER_NAME: 'BoB & friends' } });
        assert.equal(await fs.readFile(path.join(root, 'cstrike/custom.cfg'), 'utf8'), 'hostname "BoB & friends"\n');
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), expected);
        for (const CFG of ['../outside.cfg', 'bad;quit.cfg', 'game.cfg/other', '']) {
            await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, CFG } }));
        }
        for (const SERVER_NAME of ['bad"quit', 'bad;quit', 'bad\nquit', 'bad\\quit', 'bad\rquit']) {
            await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, SERVER_NAME } }));
        }
        await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, MAX_PLAYERS: '99' } }));
        await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, MAP: '../bad' } }));
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
