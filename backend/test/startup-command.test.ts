import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameStartup, formatStartup, parseStartup, applyStartupOverride } from '../src/templates/startupCommand.js';
import { nativeContainerOptions } from '../src/templates/nativeContract.js';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';
const wrapper = ['/bin/bash', '-c', 'set -euo pipefail\ncd /data/serverfiles\nexec ./hlds_linux "$@"\n', 'hlds', '-console', '+map', '{{MAP}}'];
test('startup editor hides the shell and preserves its setup script exactly', () => {
 const game = gameStartup(wrapper)!;
 assert.deepEqual(game.command, ['./hlds_linux', '-console', '+map', '{{MAP}}']);
 const edited = parseStartup('./hlds_linux -console +map {{MAP}} +hostname "My server"');
 const result = applyStartupOverride(wrapper, edited, ['MAP']);
 assert.deepEqual(result.slice(0, 4), wrapper.slice(0, 4));
 assert.deepEqual(result.slice(4), edited.slice(1));
 assert.equal(formatStartup(game.command), './hlds_linux -console +map {{MAP}}');
 assert.equal(gameStartup(['/bin/bash', '-c', 'some arbitrary setup']), null);
});
test('argv round-trips literals without shell evaluation and rejects invalid edits', () => {
 const args = ['./game', 'hello world', "a'b", '$(touch /tmp/no)', ';', '{{MAP}}', ''];
 assert.deepEqual(parseStartup(formatStartup(args)), args);
 assert.throws(() => parseStartup('game "oops'));
 assert.throws(() => parseStartup('game\nwhoami'));
 assert.throws(() => applyStartupOverride(wrapper, ['bash'], ['MAP']));
 assert.throws(() => applyStartupOverride(wrapper, ['./hlds_linux', '{{UNKNOWN}}'], ['MAP']));
});
test('saved startup overrides resolve variables with the native runtime contract', () => {
 const t = structuredClone(NATIVE_CS16_TEMPLATE);
 const ports = { tcp: [], udp: [{ host: 27050, container: 27015, label: 'Game' }] };
 const env = ['SERVER_PORT=27015', 'MAP=de_dust2', 'MAX_PLAYERS=16'];
 const command = nativeContainerOptions(t, env, ports, ['/data/hlds_linux', '-port', '{{SERVER_PORT}}', '+map', '{{MAP}}', '+maxplayers', '{{MAX_PLAYERS}}']).command;
 assert.deepEqual(command, ['/data/hlds_linux', '-port', '27015', '+map', 'de_dust2', '+maxplayers', '16']);
});
