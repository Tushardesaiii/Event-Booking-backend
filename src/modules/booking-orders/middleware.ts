import type { MiddlewareHandler } from 'hono';
import { badRequest } from '../../lib/errors.js';
import { db } from '../../db/client.js';
import { updateBookingOrderSchema } from './validation.js';
import { findBookingOrderByTenantAndOrderNumber } from './repository.js';
import type { AppEnv } from '../../types/context.js';

async function parseJsonBody(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  try {
    return await c.req.json();
  } catch {
    throw badRequest('Invalid JSON payload');
  }
}

// Middleware that allows idempotent cancellation: if client requests `status: 'cancelled'` without `cancellationReason`
// but the order is already cancelled, accept the request by injecting the existing reason so downstream validation passes.
export function validateUpdateBookingBody(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const raw = await parseJsonBody(c);

    const parsed = updateBookingOrderSchema.safeParse(raw);

    if (parsed.success) {
      c.set('validatedBody', parsed.data);
      await next();
      return;
    }

    // If validation failed because cancellationReason is missing while status is 'cancelled'
    if (raw && raw.status === 'cancelled' && raw.cancellationReason === undefined) {
      const tenant = c.get('tenant');

      if (!tenant) {
        throw badRequest('Tenant context required');
      }

      const orderNumber = c.req.param('orderNumber');

      if (!orderNumber) {
        throw badRequest('Booking order number is required');
      }

      const current = await findBookingOrderByTenantAndOrderNumber(db, tenant.id, orderNumber);

      if (current && current.status === 'cancelled') {
        // inject existing cancellationReason (can be null) so schema validation succeeds
        const augmented = { ...raw, cancellationReason: current.cancellationReason ?? null };
        const reparse = updateBookingOrderSchema.safeParse(augmented);

        if (reparse.success) {
          c.set('validatedBody', reparse.data);
          await next();
          return;
        }
      }
    }

    throw badRequest('Validation failed', parsed.error.flatten());
  };
}

export default { validateUpdateBookingBody };
