import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// Generate at this runtime: arbitrary caller headers must not enter our logs.
export const requestContext: RequestHandler = (_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
};
