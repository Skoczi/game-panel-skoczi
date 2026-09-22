import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cs16GameConfig, parseValveConfig, updateValveConfig } from '../src/templates/gameConfig.js';
import { validateTemplate, templateHash } from '../src/templates/schema.js';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';
import { nativeGameConfig } from '../src/services/nativeGameConfig.js';
import { readFileSync } from 'node:fs';
import type { GameServerRow } from '../src/types/gameServer.js';

test('CFG edits preserve BOM, CRLF, comments, unrelated commands and earlier duplicate assignments', () => {
    const content = '\uFEFF// welcome\r\nhostname "First" // example\r\n  hostname\t"Last // server"   // keep\r\nsv_custom 99\r\nexec addons.cfg\r\nmp_timelimit 20';
    assert.equal(parseValveConfig(content).values.hostname, 'Last // server');
    const result = updateValveConfig(content, cs16GameConfig(), { hostname: 'New server', mp_timelimit: '30' });
    assert.equal(result, content.replace('"Last // server"', '"New server"').replace('mp_timelimit 20', 'mp_timelimit "30"'));
    assert.equal(parseValveConfig(result).values.hostname, 'New server');
    assert.equal(updateValveConfig(content, cs16GameConfig(), {}), content);
});
test('CFG missing keys append without uncommenting examples or writing defaults', () => {
    const content = '// mp_friendlyfire 1\nsv_custom 99';
    assert.equal(updateValveConfig(content, cs16GameConfig(), { mp_friendlyfire: '0', sv_password: '' }), content + '\nmp_friendlyfire "0"\nsv_password ""\n');
});
test('CFG refuses ambiguous syntax and unsafe values instead of damaging the file', () => {
    for (const content of ['hostname "before"; hostname "after"', '/* hostname old */', 'hostname "unfinished', 'hostname a b']) {
        assert.throws(() => updateValveConfig(content, cs16GameConfig(), { hostname: 'New name' }));
    }
    for (const hostname of ['bad"name', 'bad\\name', 'bad\nname', 'bad;quit']) assert.throws(() => updateValveConfig('', cs16GameConfig(), { hostname }));
    assert.throws(() => updateValveConfig('', cs16GameConfig(), { quit: '1' }));
    assert.throws(() => updateValveConfig('', cs16GameConfig(), { mp_timelimit: 'NaN' }));
    assert.throws(() => updateValveConfig('', cs16GameConfig(), { mp_friendlyfire: 'yes' }));
    assert.throws(() => updateValveConfig('', cs16GameConfig(), { mp_roundtime: '900' }));
});
test('template configuration validates field schema, file scope and backwards compatible hashes', () => {
    const original = validateTemplate(NATIVE_CS16_TEMPLATE);
    assert.equal(templateHash(original), templateHash(validateTemplate(JSON.parse(JSON.stringify(original)))));
    assert(!Object.hasOwn(original, 'gameConfig'));
    const definition = cs16GameConfig();
    const template = { ...original, configFiles: [{ root: definition.root, path: definition.path, label: 'Server settings' }], gameConfig: definition };
    assert.deepEqual(validateTemplate(template).gameConfig, definition);
    assert.equal(validateTemplate({ ...template, gameConfig: false }).gameConfig, false);
    const bad = (change: (t: typeof template) => void) => { const clone = structuredClone(template); change(clone); assert.throws(() => validateTemplate(clone)); };
    bad(t => { t.gameConfig.path = '/other.cfg'; });
    bad(t => { t.gameConfig.sections[0].fields[1].type = 'text'; });
    bad(t => { t.gameConfig.sections[0].fields.push(t.gameConfig.sections[0].fields[0]); });
    bad(t => { t.gameConfig.sections[1].fields[0].min = 2000; });
    bad(t => { t.gameConfig.sections[0].fields[0].key = '__proto__'; });
});

test('active config filename comes from the installed runtime, not pending settings or environment visibility', () => {
    const template = validateTemplate(JSON.parse(readFileSync(new URL('../../examples/game-templates/rehlds.json', import.meta.url), 'utf8')));
    const server = (document = template, cfg = 'ffa.cfg'): GameServerRow => ({
        id: 8, name: 'Private panel alias', env_json: JSON.stringify([`CFG=${cfg}`, 'SERVER_PORT=27015']), ports_json: JSON.stringify({ tcp: [], udp: [{ container: 27015, host: 27050 }] }),
        provider_metadata_json: JSON.stringify({ template: { document, hash: templateHash(document) }, pendingConfiguration: { env: ['CFG=after-restart.cfg'] } }),
    } as GameServerRow);
    assert.equal(nativeGameConfig(server())?.path, '/serverfiles/cstrike/ffa.cfg');
    const legacy = structuredClone(template); delete legacy.gameConfig;
    assert.equal(nativeGameConfig(server(legacy))?.path, '/serverfiles/cstrike/ffa.cfg');
    assert.equal(nativeGameConfig(server({ ...template, gameConfig: false })), null);
    assert.throws(() => nativeGameConfig(server(template, '../outside.cfg')), /invalid/);
    const overridden = server();
    const overriddenMetadata = JSON.parse(overridden.provider_metadata_json!); overriddenMetadata.customParams = ['+servercfgfile', 'custom.cfg'];
    overridden.provider_metadata_json = JSON.stringify(overriddenMetadata);
    assert.equal(nativeGameConfig(overridden)?.path, '/serverfiles/cstrike/custom.cfg');
    const tampered = server();
    const metadata = JSON.parse(tampered.provider_metadata_json!); metadata.template.document.name = 'Changed without a new version';
    tampered.provider_metadata_json = JSON.stringify(metadata);
    assert.throws(() => nativeGameConfig(tampered), /checksum mismatch/);
});
