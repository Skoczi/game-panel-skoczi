import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeRehldsStartup } from '../src/templates/rehldsStartup.js';
import { validateTemplate } from '../src/templates/schema.js';

test('ReHLDS startup leaves hostname and the whole owner config unchanged', async () => {
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
        const expected = '// keep\nsv_lan 0\nhostname old\nexec server.cfg\nhostname duplicate\n';
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), expected);
        await assert.rejects(fs.stat(path.join(root, 'cstrike/server.cfg.bak')));
        await assert.rejects(fs.stat(path.join(root, 'cstrike/gamepanel-startup.cfg')));
        await promisify(execFile)('bash', ['-c', script, 'hlds'], { env });
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), expected);
        await promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, CFG: 'custom.cfg', SERVER_NAME: 'BoB & friends' } });
        await assert.rejects(fs.stat(path.join(root, 'cstrike/custom.cfg')));
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), expected);
        for (const CFG of ['../outside.cfg', 'bad;quit.cfg', 'game.cfg/other', '']) {
            await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, CFG } }));
        }
        const legacy = await fs.readFile(new URL('./fixtures/legacy-rehlds-start.sh', import.meta.url), 'utf8');
        const original = ['/bin/bash', '-c', legacy, 'hlds'];
        const normalized = normalizeRehldsStartup(original);
        assert.equal(normalized[2], source);
        assert.equal(original[2], legacy);
        assert(!normalized[2].includes('SERVER_NAME'));
        assert.equal(normalizeRehldsStartup(normalized), normalized);
        const custom = ['/bin/bash', '-c', 'echo "$SERVER_NAME"'];
        assert.equal(normalizeRehldsStartup(custom), custom);
        // Simulate a manual edit between starts, with the old container env still present.
        const renamed = 'hostname "Puszka Pandory [FFA] @eserv.pl" // keep my name\n';
        await fs.writeFile(path.join(root, 'cstrike/server.cfg'), renamed);
        await promisify(execFile)('bash', ['-c', normalized[2].replace('cd /data/serverfiles', 'cd "$TEST_ROOT"'), 'hlds'], { env });
        assert.equal(await fs.readFile(path.join(root, 'cstrike/server.cfg'), 'utf8'), renamed);
        assert(!document.variables.some(v => v.key === 'SERVER_NAME'));
        await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, MAX_PLAYERS: '99' } }));
        await assert.rejects(promisify(execFile)('bash', ['-c', script, 'hlds'], { env: { ...env, MAP: '../bad' } }));
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
