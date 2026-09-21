import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupDtos } from '../src/services/apiBackupDto.js';
test('backup DTO exposes archive metadata without paths, symlinks or invented directory sizes', () => {
    const data = backupDtos({ root: '/private', entries: [
        { name: 'żółw.tar.gz', type: 'file', size: 512, modifiedAt: '2026-09-21T12:00:00Z', path: '/private/archive' },
        { name: 'a-directory', type: 'directory', size: 4096, modifiedAt: 'invalid' },
    ] });
    assert.deepEqual(data[0], { name: 'a-directory', kind: 'directory', sizeBytes: null, modifiedAt: null });
    assert.equal(data[1].sizeBytes, 512);
    assert(!JSON.stringify(data).includes('/private'));
    assert.throws(() => backupDtos({ entries: [{ name: '../outside', type: 'file' }] }));
    assert.throws(() => backupDtos({ entries: [{ name: 'outside', type: 'symlink' }] }));
    assert.throws(() => backupDtos({ entries: new Array(2001) }));
    assert.throws(() => backupDtos({}));
});
