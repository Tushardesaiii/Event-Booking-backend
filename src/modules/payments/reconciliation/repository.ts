import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { reconciliationReports } from '../../../db/schema/payments.js';

type DBType = typeof db;
type TxOrDb = DBType | Parameters<Parameters<DBType['transaction']>[0]>[0];

export const reconciliationRepository = {
  /**
   * Insert a new reconciliation discrepancy report
   */
  async createReport(
    dbConn: TxOrDb,
    data: {
      tenantId: string;
      paymentTransactionId?: string | null;
      razorpayPaymentId?: string | null;
      discrepancyType: 'missing_capture' | 'duplicate_capture' | 'orphaned_payment' | 'orphaned_refund' | 'amount_mismatch' | 'currency_mismatch';
      details: any;
      status?: string;
    }
  ) {
    const [record] = await dbConn
      .insert(reconciliationReports)
      .values({
        tenantId: data.tenantId,
        paymentTransactionId: data.paymentTransactionId ?? null,
        razorpayPaymentId: data.razorpayPaymentId ?? null,
        discrepancyType: data.discrepancyType,
        details: data.details ?? {},
        status: data.status ?? 'open'
      })
      .returning();

    return record;
  },

  /**
   * Find reconciliation reports for a tenant
   */
  async listReports(
    dbConn: TxOrDb,
    tenantId: string,
    page = 1,
    limit = 20
  ) {
    const offset = (page - 1) * limit;

    const items = await dbConn
      .select()
      .from(reconciliationReports)
      .where(eq(reconciliationReports.tenantId, tenantId))
      .orderBy(desc(reconciliationReports.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await dbConn
      .select({ count: sql<number>`count(*)::int` })
      .from(reconciliationReports)
      .where(eq(reconciliationReports.tenantId, tenantId));

    const total = countResult?.count ?? 0;

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  /**
   * Resolve a report discrepancy
   */
  async resolveReport(dbConn: TxOrDb, tenantId: string, id: string) {
    const [record] = await dbConn
      .update(reconciliationReports)
      .set({ status: 'resolved' })
      .where(and(eq(reconciliationReports.tenantId, tenantId), eq(reconciliationReports.id, id)))
      .returning();

    return record ?? null;
  }
};
