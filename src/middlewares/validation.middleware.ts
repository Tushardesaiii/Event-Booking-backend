import type { MiddlewareHandler } from 'hono';
import type { ZodTypeAny } from 'zod';

import { badRequest } from '../lib/errors.js';
import type { AppEnv } from '../types/context.js';

async function parseJsonBody(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  try {
    return await c.req.json();
  } catch {
    throw badRequest('Invalid JSON payload');
  }
}

function parseQuery(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  return Object.fromEntries(new URL(c.req.url).searchParams.entries());
}

export function validateBody(schema: ZodTypeAny): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const parsed = schema.safeParse(await parseJsonBody(c));

    if (!parsed.success) {
      throw badRequest('Validation failed', parsed.error.flatten());
    }

    c.set('validatedBody', parsed.data);
    await next();
  };
}

export function validateQuery(schema: ZodTypeAny): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const parsed = schema.safeParse(parseQuery(c));

    if (!parsed.success) {
      throw badRequest('Validation failed', parsed.error.flatten());
    }

    c.set('validatedQuery', parsed.data);
    await next();
  };
}

export function validateParams(schema: ZodTypeAny): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const parsed = schema.safeParse(c.req.param());

    if (!parsed.success) {
      throw badRequest('Validation failed', parsed.error.flatten());
    }

    c.set('validatedParams', parsed.data);
    await next();
  };
}
