import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requestContext } from '../src/middleware/requestContext.js';
import { sendRouteError } from '../src/utils/routeErrors.js';

test('route errors correlate with headers, reject caller IDs and preserve conflict semantics', async () => {
    const app = express();
    app.use(requestContext);
    app.get('/conflict', (_req, res) => {
        void sendRouteError(res, Object.assign(new Error('Reload the newer file.'), { statusCode: 409 }), {
            route: 'TEST', fallbackMessage: 'Failed.',
        });
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
        const address = server.address() as { port: number };
        const response = await fetch(`http://127.0.0.1:${address.port}/conflict`, { headers: { 'X-Request-ID': 'untrusted' } });
        const body = await response.json() as any;
        assert.equal(response.status, 409);
        assert.equal(body.error, 'Reload the newer file.');
        assert.equal(body.code, 'CONFLICT');
        assert.equal(body.requestId, response.headers.get('x-request-id'));
        assert.match(body.requestId, /^[0-9a-f-]{36}$/);
        const second = await fetch(`http://127.0.0.1:${address.port}/conflict`);
        assert.notEqual(second.headers.get('x-request-id'), body.requestId);
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
