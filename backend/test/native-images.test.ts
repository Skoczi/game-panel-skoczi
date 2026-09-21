import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWithMocks } from './loadWithMocks.js';
import { TemplateError } from '../src/templates/schema.js';
import { NATIVE_CS16_TEMPLATE } from '../src/templates/nativeCs16.js';

test('image preflight pins both images and fails closed on missing, wrong architecture or daemon errors', async () => {
    const requests: string[] = [];
    let failure: unknown;
    let architecture = 'amd64';
    const module = loadWithMocks('../src/services/nativeImages.ts', {
        '../utils/docker/client.js': { docker: { getImage: (reference: string) => ({ inspect: async () => {
            requests.push(reference);
            if (failure) throw failure;
            return { Id: 'sha256:' + (reference === 'installer:v1' ? 'b' : 'a').repeat(64), Os: 'linux', Architecture: architecture };
        } }) } },
        '../templates/schema.js': { TemplateError },
    }, { process: { arch: 'x64' } });
    const template = structuredClone(NATIVE_CS16_TEMPLATE);
    template.lifecycle!.installerImage = 'installer:v1';
    const resolved = await module.resolveNativeImages(template);
    assert.equal(resolved.nativeRuntimeImage, 'sha256:' + 'a'.repeat(64));
    assert.equal(resolved.nativeInstallerImage, 'sha256:' + 'b'.repeat(64));
    assert.deepEqual(requests, [template.runtime.image, 'installer:v1']);
    requests.length = 0; delete template.lifecycle!.installerImage;
    await module.resolveNativeImages(template); assert.equal(requests.length, 1);
    failure = { statusCode: 404 };
    await assert.rejects(module.resolveNativeImages(template), (e: any) => e.statusCode === 409 && /no installation was started/.test(e.message));
    failure = new Error('sensitive daemon detail');
    await assert.rejects(module.resolveNativeImages(template), (e: any) => e.statusCode === 503 && !/sensitive/.test(e.message));
    failure = undefined; architecture = 'arm64';
    await assert.rejects(module.resolveNativeImages(template), /Linux amd64/);
});
