import type { NextFunction, Request, Response } from 'express';
import type { JWTPayload } from '../utils/auth.js';
import { extractTokenFromHeader, verifyToken } from '../utils/auth.js';
import { userRepository, serverMemberRepository } from '../database/index.js';
import { parsePositiveIntId } from '../utils/ids.js';
import { logError } from '../utils/logger.js';
import { PERMISSIONS } from '../permissions.js';
import { isAgent } from '../agent/identity.js';
import type { Delegation } from '../nodes/delegation.js';

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const payload = verifyToken(token);
    if (payload.delegation) {
      if (!isAgent()) throw new Error('Agent-only credential');
      req.user = payload;
      next();
      return;
    }

    const user = await userRepository.findById(payload.userId);
    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    if (!user.is_enabled) {
      res.status(403).json({ error: 'Account disabled' });
      return;
    }

    if (payload.tokenVersion !== user.token_version) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.user = { ...payload, isRoot: Boolean(user.is_root) };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function rootOnly(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isRoot) {
    res.status(403).json({ error: 'Root access required' });
    return;
  }
  next();
}

export function requireGlobalPermission(perm: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Root bypass
      if (req.user.isRoot) {
        next();
        return;
      }

      const perms = req.user.delegation
        ? []
        : await userRepository.getGlobalPermissions(req.user.userId);

      if (perms.includes('*') || perms.includes(perm)) {
        next();
        return;
      }

      res.status(403).json({ error: 'Insufficient permissions' });
    } catch (err) {
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

export function requireServerPermission(permission: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Root bypass
      if (req.user.isRoot) {
        return next();
      }

      const serverId = parsePositiveIntId(req.params.id);
      if (!serverId) {
        return res.status(400).json({ error: 'Invalid server id' });
      }

      const permissions = await serverPermissions(req.user, serverId);

      if (permissions.includes('*') || permissions.includes(permission)) {
        return next();
      }

      return res.status(403).json({ error: 'Insufficient server permissions' });
    } catch (err) {
      return res.status(500).json({ error: 'Server authorization failed' });
    }
  };
}

export async function userHasServerPermission(
  user: JWTPayload | undefined,
  serverId: number,
  permission: string,
): Promise<boolean> {
  if (!user) return false;
  if (user.isRoot) return true;

  const perms = await serverPermissions(user, serverId);
  return perms.includes('*') || perms.includes(permission);
}

export type ServerPrincipal = {
  userId?: number;
  isRoot?: boolean;
  delegation?: Delegation;
};
export async function serverPermissions(
  user: ServerPrincipal,
  serverId: number,
): Promise<string[]> {
  if (user.delegation)
    return user.delegation.serverId === serverId ? user.delegation.permissions : [];
  if (!user.userId) return [];
  return serverMemberRepository.getUserServerPermissions(serverId, user.userId);
}
export async function buildServerVisibility(
  user: ServerPrincipal | undefined,
): Promise<(id: number) => boolean> {
  if (user?.isRoot) return () => true;
  if (user?.delegation) return (id) => id === user.delegation!.serverId;
  if (!user?.userId) return () => false;
  const ids = new Set(
    (await serverMemberRepository.listByUser(user.userId)).map((m) => m.server_id),
  );
  return (id) => ids.has(id);
}

export async function buildServerEnvVisibility(
  user: ServerPrincipal | undefined,
): Promise<(serverId: number) => boolean> {
  if (user?.isRoot) return () => true;
  if (!user?.userId) return () => false;
  if (user.delegation)
    return (id) =>
      id === user.delegation!.serverId &&
      user.delegation!.permissions.includes(PERMISSIONS.server.env);

  const memberships = (await serverMemberRepository.listByUser(user.userId)) as Array<{
    server_id: number;
    permissions_json: string;
  }>;

  const allowed = new Set<number>();
  for (const membership of memberships) {
    let perms: string[] = [];
    try {
      const parsed = JSON.parse(membership.permissions_json ?? '[]');
      if (Array.isArray(parsed)) perms = parsed.filter((x) => typeof x === 'string');
    } catch {
      // Treat unparseable permissions as none.
    }
    if (perms.includes('*') || perms.includes(PERMISSIONS.server.env)) {
      allowed.add(membership.server_id);
    }
  }

  return (serverId: number) => allowed.has(serverId);
}

type HttpError = Error & {
  status?: number;
  name?: string;
};

function toHttpError(error: unknown): HttpError {
  if (error instanceof Error) return error as HttpError;
  return new Error('Unknown error');
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const err = toHttpError(error);
  logError('MIDDLEWARE:ERROR_HANDLER', err);

  switch (err.name) {
    case 'ValidationError':
      res.status(400).json({ error: err.message });
      return;

    case 'UnauthorizedError':
      res.status(401).json({ error: 'Unauthorized' });
      return;

    case 'NotFoundError':
      res.status(404).json({ error: 'Not found' });
      return;

    default: {
      const statusCode = err.status ?? (err as any).statusCode ?? 500;
      const safeMessage =
        statusCode >= 500 ? 'Internal server error' : err.message || 'Request failed';
      res.status(statusCode).json({ error: safeMessage });
    }
  }
}
