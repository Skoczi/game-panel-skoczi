import { test, expect } from '@playwright/test';
import { mapBackendStatusToUi, formatServerStatusLabel, isServerDownLike } from '../utils/serverRuntime';
import { apiErrorMessage, mutationOutcomeUnknown } from '../utils/apiError';

test('missing or unreachable runtime is unknown rather than a stopped game', () => {
  for (const value of [null, undefined, '', 'offline', 'error', 'unexpected']) {
    expect(mapBackendStatusToUi(value)).toBe('unknown');
    expect(formatServerStatusLabel(value)).toBe('Unknown');
    expect(isServerDownLike(value)).toBe(false);
  }
  expect(mapBackendStatusToUi('exited')).toBe('stopped');
  expect(mapBackendStatusToUi('running')).toBe('running');
});

test('API error references preserve server guidance without echoing arbitrary header content', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  expect(apiErrorMessage({ response: { data: { error: 'Reload the file.', requestId } } }, 'Failed'))
    .toBe(`Reload the file. (Reference: ${requestId})`);
  expect(apiErrorMessage({ response: { data: { error: 'Failed', requestId: 'untrusted text' } } }, 'Fallback')).toBe('Failed');
});


test('lost mutation responses remain unknown and read errors do not imply accepted commands', () => {
  expect(mutationOutcomeUnknown('post', '/api/servers/7/backups/create')).toBe(true);
  expect(mutationOutcomeUnknown('post', '/api/nodes/node/runtime/api/servers/7/restart', 502)).toBe(true);
  expect(mutationOutcomeUnknown('post', '/api/servers/7/backups/restore', 409)).toBe(false);
  expect(mutationOutcomeUnknown('get', '/api/servers/7/backups/create', 502)).toBe(false);
});
