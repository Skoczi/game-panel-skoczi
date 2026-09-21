import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_APPEARANCE, GlobalSettingsStore, validateGlobalSettings, allocationPolicy, type GlobalSettings } from '../src/services/globalSettingsStore.js';
import { assertPortPolicy, configuredPortPolicy, setManagedPortPolicy } from '../src/utils/portPolicy.js';

const seed = (): GlobalSettings => ({ appearance: { ...DEFAULT_APPEARANCE }, network: { restrictPorts: true, allocations: [{ ip: '192.0.2.10', alias: 'Game node', tcp: '27015-27030', udp: '27015-27030' }] } });

test('login theme migrates once and persists without changing branding or allocations', async () => {
    const { native, db } = database();
    try {
        native.exec('CREATE TABLE panel_settings(id INTEGER PRIMARY KEY, revision INTEGER, settings_json TEXT)');
        const { loginTheme: _theme, ...appearance } = seed().appearance;
        const old = { ...seed(), appearance: { ...appearance, siteName: 'Community' } };
        native.prepare('INSERT INTO panel_settings VALUES(1, 12, ?)').run(JSON.stringify(old));
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
        assert.deepEqual(store.snapshot(), { ...old, appearance: { ...old.appearance, loginTheme: 'light' }, revision: 13 });
        const next = { ...store.snapshot(), appearance: { ...store.snapshot().appearance, loginTheme: 'dark' as const } };
        const { revision, ...value } = next;
        await store.save(value, revision);
        const reloaded = new GlobalSettingsStore(db, () => {}); await reloaded.initialize(seed());
        assert.equal(reloaded.snapshot().appearance.loginTheme, 'dark');
        assert.equal(reloaded.snapshot().revision, 14);
        assert.deepEqual(reloaded.snapshot().network, old.network);
        for (const loginTheme of ['system', 'light', 'dark'] as const)
            assert.equal(validateGlobalSettings({ ...seed(), appearance: { ...appearance, loginTheme } }).appearance.loginTheme, loginTheme);
        for (const loginTheme of [undefined, null, true, 'auto', 'DARK', {}])
            assert.throws(() => validateGlobalSettings({ ...seed(), appearance: { ...appearance, loginTheme } }), /login theme/);
    } finally { native.close(); }
});

test('branding validates lengths, image protocols, content signatures and size', () => {
    for (const logo of ['javascript:alert(1)', 'http://example.com/logo.png', '//example.com/logo.png', 'https://', 'https://user:password@example.com/logo.png',
        'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz4=',
        'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(256 * 1024)]).toString('base64')]) {
        const value = seed(); value.appearance.logo = logo;
        assert.throws(() => validateGlobalSettings(value), /Logo/);
    }
    const value = seed(); value.appearance.logo = 'https://example.com/logo.png';
    assert.equal(validateGlobalSettings(value).appearance.logo, value.appearance.logo);
    value.appearance.logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=';
    assert.equal(validateGlobalSettings(value).appearance.logo, value.appearance.logo);
    for (const [key, text] of [['siteName', ''], ['siteName', 'a'.repeat(81)], ['loginFooter', 'a'.repeat(241)]]) {
        assert.throws(() => validateGlobalSettings({ ...seed(), appearance: { ...DEFAULT_APPEARANCE, [key]: text } }));
    }
});

test('upgrading .3 adds branding once without changing policies or prior switches', async () => {
    const { native, db } = database();
    try {
        native.exec('CREATE TABLE panel_settings(id INTEGER PRIMARY KEY, revision INTEGER, settings_json TEXT)');
        const old = { ...seed(), appearance: { showFollowUs: false, showTrustpilot: false } };
        native.prepare('INSERT INTO panel_settings VALUES(1, 7, ?)').run(JSON.stringify(old));
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
        assert.deepEqual(store.snapshot().network, old.network);
        assert.equal(store.snapshot().appearance.showFollowUs, false);
        assert.equal(store.snapshot().appearance.showNews, false);
        assert.equal(store.snapshot().appearance.siteName, 'Game Panel PRO');
        assert.equal(store.snapshot().revision, 8);
        const reloaded = new GlobalSettingsStore(db, () => {}); await reloaded.initialize(seed());
        assert.equal(reloaded.snapshot().revision, 8);
        const updated = { appearance: { ...reloaded.snapshot().appearance, siteName: 'Example games', showNews: false }, network: old.network };
        await reloaded.save(updated, 8);
        const again = new GlobalSettingsStore(db, () => {}); await again.initialize(seed());
        assert.equal(again.snapshot().appearance.siteName, 'Example games');
        assert.equal(again.snapshot().appearance.showNews, false);
    } finally { native.close(); }
});
test('edition defaults do not overwrite existing branding or allocations', async () => {
    assert.equal(DEFAULT_APPEARANCE.siteSubtitle, 'Server management');
    assert.match(DEFAULT_APPEARANCE.loginFooter, /Based on OVHcloud Game Panel/);
    const { native, db } = database();
    try {
        native.exec('CREATE TABLE panel_settings(id INTEGER PRIMARY KEY, revision INTEGER, settings_json TEXT)');
        const old = seed();
        old.appearance.siteName = 'Community';
        old.appearance.siteSubtitle = 'by Skoczi';
        old.appearance.loginFooter = 'Game Panel by Skoczi';
        old.appearance.logo = 'https://example.com/logo.png';
        native.prepare('INSERT INTO panel_settings VALUES(1, 9, ?)').run(JSON.stringify(old));
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
        assert.deepEqual(store.snapshot(), { ...old, revision: 9 });
    } finally { native.close(); }
});

function database() {
    const native = new DatabaseSync(':memory:');
    native.exec('CREATE TABLE game_servers (id INTEGER PRIMARY KEY, name TEXT, ports_json TEXT)');
    const db: any = {
        exec: async (sql: string) => native.exec(sql),
        get: async (sql: string, ...args: any[]) => native.prepare(sql).get(...args),
        all: async (sql: string, ...args: any[]) => native.prepare(sql).all(...args),
        run: async (sql: string, ...args: any[]) => native.prepare(sql).run(...args),
    };
    return { native, db };
}

test('settings persist in SQLite, reload, and update the live policy', async () => {
    const { native, db } = database();
    try {
        const apply = (value: GlobalSettings) => setManagedPortPolicy(allocationPolicy(value.network));
        const store = new GlobalSettingsStore(db, apply);
        await store.initialize(seed());
        assert.equal(store.snapshot().revision, 1);
        const next = seed(); next.appearance.showFollowUs = false; next.network.allocations[0].tcp = '28015';
        await store.save(next, 1);
        assert.throws(() => assertPortPolicy({ tcp: [{ host: 27015, hostIp: '192.0.2.10' }], udp: [] }), /not allowed/);
        assert.equal(configuredPortPolicy()!['192.0.2.10'].tcp[0].from, 28015);
        const reloaded = new GlobalSettingsStore(db, apply);
        await reloaded.initialize(seed());
        assert.equal(reloaded.snapshot().appearance.showFollowUs, false);
        assert.equal(reloaded.snapshot().network.allocations[0].tcp, '28015');
        assert.equal(reloaded.snapshot().revision, 2);
        const clone = reloaded.snapshot(); clone.network.allocations.length = 0;
        assert.equal(reloaded.snapshot().network.allocations.length, 1);
        await assert.rejects(store.save(seed(), 1), /Reload/);
    } finally { native.close(); }
});

test('assigned ports prevent removal/shrinking; appearance changes and range expansion remain allowed', async () => {
    const { native, db } = database();
    try {
        native.prepare('INSERT INTO game_servers VALUES (1, ?, ?)').run('Test game', JSON.stringify({ tcp: [], udp: [{ host: 27020, container: 27015, hostIp: '192.0.2.10' }] }));
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
        assert.deepEqual(await store.assignments(), [{ serverId: 1, serverName: 'Test game', protocol: 'udp', ip: '192.0.2.10', port: 27020 }]);
        const remove = seed(); remove.network.allocations = [];
        await assert.rejects(store.save(remove, 1), /Allocation in use by Test game/);
        const shrink = seed(); shrink.network.allocations[0].udp = '27015';
        await assert.rejects(store.save(shrink, 1), /27020\/udp/);
        assert.equal(store.snapshot().revision, 1);
        const appearance = seed(); appearance.appearance.showTrustpilot = false;
        await store.save(appearance, 1);
        appearance.network.allocations[0].udp = '27015-27040';
        await store.save(appearance, 2);
        assert.equal(store.snapshot().revision, 3);
    } finally { native.close(); }
});

test('legacy wildcard bindings must be reassigned before enabling restrictions', async () => {
    const { native, db } = database();
    try {
        native.prepare('INSERT INTO game_servers VALUES (1, ?, ?)').run('Legacy game', JSON.stringify({ tcp: [{ host: 27015 }], udp: [] }));
        const legacy = seed(); legacy.network.restrictPorts = false;
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(legacy);
        await assert.rejects(store.save(seed(), 1), /Docker default/);
    } finally { native.close(); }
});

test('concurrent saves cannot overwrite the same revision', async () => {
    const { native, db } = database();
    try {
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
        const a = seed(); a.appearance.showFollowUs = false;
        const b = seed(); b.appearance.showTrustpilot = false;
        const results = await Promise.allSettled([store.save(a, 1), store.save(b, 1)]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(store.snapshot().revision, 2);
    } finally { native.close(); }
});

test('settings reject malformed input and duplicate IPs without coercion', () => {
    for (const bad of [null, [], {}, { ...seed(), extra: true }, { ...seed(), appearance: { showFollowUs: 'false', showTrustpilot: true } },
        { ...seed(), network: { restrictPorts: true, allocations: [seed().network.allocations[0], seed().network.allocations[0]] } }]) assert.throws(() => validateGlobalSettings(bad));
    for (const [key, value] of [['ip', '0.0.0.0'], ['ip', '::1'], ['udp', '8080junk'], ['tcp', '27030-27015'], ['alias', 'x'.repeat(81)]]) {
        const bad: any = seed(); bad.network.allocations[0][key] = value;
        assert.throws(() => validateGlobalSettings(bad));
    }
});

test('database write failure leaves active settings unchanged', async () => {
    const { native, db } = database();
    try {
        let active = seed();
        const store = new GlobalSettingsStore(db, (value) => { active = value; });
        await store.initialize(seed());
        const originalRun = db.run;
        db.run = async () => { throw new Error('Simulated storage failure'); };
        const next = seed(); next.appearance.showTrustpilot = false;
        await assert.rejects(store.save(next, 1), /storage failure/);
        assert.equal(active.appearance.showTrustpilot, false);
        assert.equal(store.snapshot().revision, 1);
        db.run = originalRun;
        const reloaded = new GlobalSettingsStore(db, () => {}); await reloaded.initialize(seed());
        assert.equal(reloaded.snapshot().appearance.showTrustpilot, false);
    } finally { native.close(); }
});

test('invalid stored settings do not silently fall back to environment defaults', async () => {
    const { native, db } = database();
    try {
        const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
        native.exec("UPDATE panel_settings SET settings_json='not json'");
        let applied = false;
        const broken = new GlobalSettingsStore(db, () => { applied = true; });
        await assert.rejects(broken.initialize(seed()));
        assert.equal(applied, false);
    } finally { native.close(); }
});

test('favicon validates uploads and migrates previous settings without losing branding', async () => {
 const input = seed();
 input.appearance.favicon = 'https://example.com/icon.ico';
 assert.equal(validateGlobalSettings(input).appearance.favicon, input.appearance.favicon);
 for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/x-icon;base64,YmFk', 'https://user:pass@example.com/icon.ico']) {
  input.appearance.favicon = bad; assert.throws(() => validateGlobalSettings(input));
 }
 const { native, db } = database();
 try {
  const { favicon, ...appearance } = seed().appearance;
  native.exec('CREATE TABLE panel_settings(id INTEGER PRIMARY KEY, revision INTEGER, settings_json TEXT)');
  native.prepare('INSERT INTO panel_settings VALUES(1, 9, ?)').run(JSON.stringify({ ...seed(), appearance }));
  const store = new GlobalSettingsStore(db, () => {}); await store.initialize(seed());
  assert.equal(store.snapshot().appearance.favicon, '');
  assert.equal(store.snapshot().appearance.siteName, appearance.siteName);
  assert.equal(store.snapshot().revision, 10);
 } finally { native.close(); }
});
