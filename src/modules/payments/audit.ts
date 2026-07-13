import { db } from '../../db/client.js';
import { paymentAuditLogs } from '../../db/schema/payments.js';

export async function logPaymentAudit(
  tx: any,
  params: {
    actorId?: string | null;
    tenantId: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeState?: any;
    afterState?: any;
    metadata?: any;
  }
) {
  const connection = tx || db;
  await connection.insert(paymentAuditLogs).values({
    actorId: params.actorId ?? null,
    tenantId: params.tenantId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    beforeState: params.beforeState ?? null,
    afterState: params.afterState ?? null,
    metadata: params.metadata ?? {}
  });
}
