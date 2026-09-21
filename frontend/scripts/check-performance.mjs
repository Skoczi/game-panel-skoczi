// Compare only measurements from the same machine and synthetic profile.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [referencePath, measuredPath] = process.argv.slice(2);
if (!referencePath || !measuredPath) throw new Error('Usage: node check-performance.mjs reference.json measured.json');
const [reference, measured] = await Promise.all([referencePath, measuredPath].map(async file => JSON.parse(await readFile(file, 'utf8'))));
assert.deepEqual(measured.profile, reference.profile, 'Measurement profiles differ');
assert.deepEqual(measured.environment, reference.environment, 'Measurement environments differ');
assert.equal(measured.errors.length, 0, 'Browser errors invalidate the run');
const metrics = { 'production-login': 'readyMs', 'production-server-fixture': 'readyMs', 'first-editor': 'durationMs', 'console-stream': 'interactionMs' };
const median = values => values.sort((a,b) => a-b)[Math.floor(values.length / 2)];
let failed = false;
for (const [scenario, metric] of Object.entries(metrics)) {
  const values = report => report.samples.filter(sample => sample.scenario === scenario).map(sample => sample[metric]);
  const baseline = values(reference), current = values(measured);
  assert.ok(baseline.length >= 3 && current.length >= 3 && [...baseline, ...current].every(Number.isFinite), 'At least three valid samples are required');
  const limit = median(baseline) * 1.1, value = median(current);
  console.log(`${scenario}: ${value.toFixed(1)} ms; budget ${limit.toFixed(1)} ms (+10%)`);
  if (value > limit) failed = true;
}
if (failed) process.exitCode = 1;
