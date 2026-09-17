import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';
import { validateDelegation, type Delegation } from '../nodes/delegation.js';

const TOKEN_EXPIRY = '120h';
const BCRYPT_SALT_ROUNDS = 10;

function jwtSecret(): string {
  return getConfig().jwtSecret;
}

export interface JWTPayload {
  userId: number;
  username: string;
  isRoot: boolean;
  tokenVersion: number;
  delegation?: Delegation;
  /** Added only by the local fleet routing guard, never by the login issuer. */
  runtimeScope?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

export async function comparePasswords(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, jwtSecret(), {
    expiresIn: payload.delegation ? '5m' : TOKEN_EXPIRY,
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string): JWTPayload {
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload');
  }

  const d = decoded as Partial<JWTPayload>;
  if (
    typeof d.userId !== 'number' ||
    typeof d.username !== 'string' ||
    typeof d.isRoot !== 'boolean' ||
    typeof d.tokenVersion !== 'number'
  ) {
    throw new Error('Invalid token payload shape');
  }

  if (d.delegation !== undefined) {
    d.delegation = validateDelegation(d.delegation);
    if (d.isRoot || d.userId !== d.delegation.actorId)
      throw new Error('Invalid delegated principal');
  }
  return d as JWTPayload;
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(' ');

  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}
