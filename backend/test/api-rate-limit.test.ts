import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRateLimit } from '../src/services/apiRateLimit.js';
test('API rate windows recover at expiry without resetting another client budget', () => {
    let now = 0;
    const rate = new ApiRateLimit(2, 60000, 10, () => now);
    assert(rate.take('one').allowed); assert(rate.take('one').allowed);
    assert.deepEqual(rate.take('one'), { allowed: false, retryAfterSeconds: 60 });
    now = 59001; assert.deepEqual(rate.take('one'), { allowed: false, retryAfterSeconds: 1 });
    assert(rate.take('two').allowed);
    now = 60000; assert(rate.take('one').allowed);
    assert(rate.take('two').allowed); assert(!rate.take('two').allowed);
});
test('API rate storage is bounded and cannot be bypassed by evicting active keys', () => {
    let now = 0;
    const rate = new ApiRateLimit(1, 1000, 2, () => now);
    assert(rate.take('one').allowed); assert(rate.take('two').allowed);
    assert(!rate.take('three').allowed); assert(!rate.take('one').allowed);
    now = 1000; assert(rate.take('three').allowed); assert(rate.take('one').allowed);
});
