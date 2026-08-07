import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config/env';

/**
 * The access token carries only identity (sub + email). Roles, permissions and
 * module access are re-resolved from the database on every request so that
 * revoking access takes effect immediately (no stale claims in a live token).
 */
export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: config.jwt.accessExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as AccessTokenPayload;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // token id, so we can look up / revoke
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: SignOptions = {
    expiresIn: config.jwt.refreshExpiresIn as SignOptions['expiresIn'],
  };
  return jwt.sign(payload, config.jwt.refreshSecret, options);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret, { algorithms: ['HS256'] }) as RefreshTokenPayload;
}

/**
 * Media token — a short-lived, single-resource grant carried in the URL query so
 * a native <video>/<iframe> (which can't set an Authorization header) can stream
 * a protected file. Signed with a SEPARATE secret and marked `scope: 'media'`, so
 * it can never be used as an access token and vice-versa. A leaked stream URL
 * expires quickly and unlocks only that one resource for that one user.
 */
export interface MediaTokenPayload {
  sub: string; // user id the grant was issued to
  k: string; // resource id (video id or document id)
  kind: 'video' | 'doc';
}

export function signMediaToken(payload: MediaTokenPayload): string {
  return jwt.sign({ ...payload, scope: 'media' }, config.media.tokenSecret, {
    expiresIn: config.media.tokenTtl as SignOptions['expiresIn'],
  });
}

export function verifyMediaToken(token: string): MediaTokenPayload {
  const decoded = jwt.verify(token, config.media.tokenSecret, { algorithms: ['HS256'] }) as MediaTokenPayload & { scope?: string };
  if (decoded.scope !== 'media') throw new Error('Not a media token');
  return { sub: decoded.sub, k: decoded.k, kind: decoded.kind };
}

/** Opaque id embedded in refresh tokens. */
export function newTokenId(): string {
  return randomBytes(16).toString('hex');
}

/** We store only a hash of the refresh token, never the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Read the `exp` claim (seconds) from a signed token as a Date. */
export function getTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (!decoded?.exp) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new Date(decoded.exp * 1000);
}
