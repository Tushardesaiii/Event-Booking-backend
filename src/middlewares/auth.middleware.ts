import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { findSessionById } from '../modules/auth/repository.js';
import { users } from '../db/schema/users.js';
import { env } from '../config/env.js';
import { verifyJwt } from '../lib/jwt.js';
import { unauthorized, notFound } from '../lib/errors.js';
import type { AppEnv } from '../types/context.js';
import type { JwtTokenClaims } from '../types/auth.js';

function extractBearerToken(header: string | null | undefined) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractBearerToken(c.req.header('authorization'));

  if (!token) {
    throw unauthorized('Unauthorized');
  }

  let payload: JwtTokenClaims;

  try {
    payload = verifyJwt<JwtTokenClaims>(token, env.ACCESS_TOKEN_SECRET, 'access');
  } catch {
    throw unauthorized('Unauthorized', { reason: 'invalid_token' });
  }

  if (!payload.sid) {
    throw unauthorized('Unauthorized', { reason: 'missing_session' });
  }

  const session = await findSessionById(db, payload.sid);

  if (!session) {
    throw unauthorized('Unauthorized', { reason: 'invalid_session' });
  }

  if (session.userId !== payload.sub) {
    throw unauthorized('Unauthorized', { reason: 'session_mismatch' });
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('Unauthorized', { reason: 'session_expired' });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    throw notFound('User not found');
  }

  c.set('session', session);
  c.set('user', user);
  c.set('authToken', token);

  await next();
};
