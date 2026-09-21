import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidCronExpression, nextCronRunAt } from '../src/utils/cron.js';

test('cron rejects partial numbers and extra separators', () => {
    for (const value of ['5abc', '*/5/2', '1-5-9', '1/', '/2', '-1', '1.5', '1,,2', '*/0', '60', '1e1']) {
        assert.throws(() => assertValidCronExpression(`${value} * * * *`), value);
    }
    assert.throws(() => assertValidCronExpression('* * * constructor *'));
    assert.equal(assertValidCronExpression('  */5  * * jan mon  '), '*/5 * * jan mon');
});
test('cron numeric steps extend to the field boundary', () => {
    assert.equal(nextCronRunAt('5/10 * * * *', new Date(2026, 0, 1, 0, 5)).getMinutes(), 15);
});
test('cron follows actual minutes through daylight-saving transitions', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Europe/Warsaw';
    try {
        assert.equal(nextCronRunAt('30 2 * * *', new Date('2026-03-29T00:59:00Z')).toISOString(), '2026-03-30T00:30:00.000Z');
        assert.equal(nextCronRunAt('30 2 * * *', new Date('2026-10-25T00:45:00Z')).toISOString(), '2026-10-25T01:30:00.000Z');
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('stepped day wildcards retain their restrictions and leap-day schedules remain valid', () => {
    const next = nextCronRunAt('0 0 */2 * *', new Date(2026, 0, 1, 0, 0));
    assert.equal(next.getDate(), 3);
    assert.equal(nextCronRunAt('0 0 29 2 *', new Date(2026, 2, 1)).getFullYear(), 2028);
});
