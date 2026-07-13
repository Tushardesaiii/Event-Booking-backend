import { and, eq, sql, isNull, inArray, asc } from 'drizzle-orm';
import { ticketTypes } from '../../../db/schema/ticket-types.js';
import { bookingOrders } from '../../../db/schema/booking-orders.js';
import { bookingOrderItems } from '../../../db/schema/booking-order-items.js';
import { inventoryReservations } from '../../../db/schema/inventory-reservations.js';
import { db } from '../../../db/client.js';
import {
  ledgerAccounts,
  ledgerTransactions,
  ledgerEntries,
  ledgerAccountBalances,
  organizerWallets,
  ledgerReconciliation,
  organizerWalletTransactions
} from '../../../db/schema/ledger.js';
import { paymentTransactions, paymentRefunds } from '../../../db/schema/payments.js';
import { financeRepository } from '../repository.js';
import { LedgerBalanceService } from '../projections/service.js';
import { AccountRegistry } from '../accounting/registry.js';
import type { FinanceAccountType } from '../types.js';

export const LedgerReconciliationService = {
  /**
   * Run comprehensive financial reconciliation checking ledger, escrow, wallets, settlements, and gateway
   */
  async runReconciliation(tenantId: string): Promise<any> {
    const discrepancies: any[] = [];
    const summary = {
      checkedAccountsCount: 0,
      totalDiscrepancies: 0,
      timestamp: new Date()
    };

    // 1. Verify that all ledger transactions are fully balanced (debits === credits)
    const transactions = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.tenantId, tenantId));

    for (const tx of transactions) {
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.ledgerTransactionId, tx.id));

      let debits = 0;
      let credits = 0;

      for (const ent of entries) {
        const amtMinor = Math.round(parseFloat(ent.amount) * 100);
        if (ent.direction === 'debit') debits += amtMinor;
        else credits += amtMinor;
      }

      if (debits !== credits) {
        discrepancies.push({
          type: 'unbalanced_transaction',
          id: tx.id,
          message: `Transaction ${tx.id} is unbalanced. Debits: ${debits/100}, Credits: ${credits/100}`
        });
      }
    }

    // 2. Verify account balances against computed entries sum
    const accounts = await db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.tenantId, tenantId));

    summary.checkedAccountsCount = accounts.length;

    for (const acc of accounts) {
      const cache = await db
        .select()
        .from(ledgerAccountBalances)
        .where(and(eq(ledgerAccountBalances.accountId, acc.id), eq(ledgerAccountBalances.tenantId, tenantId)))
        .limit(1)
        .then((res) => res[0] ?? null);

      if (!cache) {
        discrepancies.push({
          type: 'missing_balance_projection',
          accountId: acc.id,
          message: `Account ${acc.name} has no running balance projection cache`
        });
        continue;
      }

      // Compute manually from entries
      const entries = await db
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.accountId, acc.id), eq(ledgerEntries.tenantId, tenantId)));

      let debitSum = 0;
      let creditSum = 0;

      for (const ent of entries) {
        const val = parseFloat(ent.amount);
        if (ent.direction === 'debit') debitSum += val;
        else creditSum += val;
      }

      const expectedNet = creditSum - debitSum;
      const cachedNet = parseFloat(cache.balance);

      if (Math.abs(cachedNet - expectedNet) > 0.01) {
        discrepancies.push({
          type: 'balance_projection_discrepancy',
          accountId: acc.id,
          message: `Account ${acc.name} projection out of sync. Cached: ${cachedNet}, Compiled: ${expectedNet}. Rebuilding...`
        });
        // Auto-heal
        await LedgerBalanceService.rebuildBalance(tenantId, acc.id);
      }
    }

    // 3. Verify that organizer wallets match available ledger accounts
    const wallets = await db
      .select()
      .from(organizerWallets)
      .where(eq(organizerWallets.tenantId, tenantId));

    for (const wallet of wallets) {
      const orgAcc = await financeRepository.findAccountByType(db, tenantId, 'ORGANIZER_BALANCE', `Organizer Available: ${wallet.organizerId}`);
      if (orgAcc) {
        const balance = await LedgerBalanceService.getBalance(tenantId, 'ORGANIZER_BALANCE', wallet.organizerId);
        const ledgerAvailable = parseFloat(balance.balance); // Net credit - debit
        const walletAvailable = parseFloat(wallet.availableBalance);

        if (Math.abs(ledgerAvailable - walletAvailable) > 0.01) {
          discrepancies.push({
            type: 'organizer_wallet_mismatch',
            organizerId: wallet.organizerId,
            message: `Wallet available balance (${walletAvailable}) does not match ledger (${ledgerAvailable})`
          });
        }
      }
    }

    // 4. Verify that captured payment transactions have matching ledger entries
    const gatewayTransactions = await db
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.tenantId, tenantId), eq(paymentTransactions.status, 'captured')));

    for (const gt of gatewayTransactions) {
      const matches = await db
        .select()
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenantId),
            eq(ledgerTransactions.referenceType, 'payment_transaction'),
            eq(ledgerTransactions.referenceId, gt.id)
          )
        );

      if (matches.length === 0) {
        discrepancies.push({
          type: 'missing_ledger_posting',
          paymentTransactionId: gt.id,
          message: `Captured payment transaction ${gt.razorpayPaymentId} has no ledger journal transaction`
        });
      }
    }

    summary.totalDiscrepancies = discrepancies.length;
    const runStatus = discrepancies.length > 0 ? 'discrepancies_found' : 'completed';

    const [record] = await db
      .insert(ledgerReconciliation)
      .values({
        tenantId,
        runType: 'ledger_financial',
        status: runStatus,
        summary,
        discrepancies
      })
      .returning();

    return record;
  },

  /**
   * Verify platform escrow running balance against the sum of pending organizer credits (pre-settled funds)
   */
  async verifyEscrowBalance(tenantId: string): Promise<any> {
    const escrowAcc = await AccountRegistry.resolveAccount(db, {
      tenantId,
      type: 'PLATFORM_ESCROW'
    });

    const balanceRow = await db
      .select()
      .from(ledgerAccountBalances)
      .where(and(eq(ledgerAccountBalances.accountId, escrowAcc.id), eq(ledgerAccountBalances.tenantId, tenantId)))
      .limit(1)
      .then(res => res[0] ?? null);

    const ledgerBalance = balanceRow ? parseFloat(balanceRow.balance) : 0.0;

    const pendingWalletTxns = await db
      .select()
      .from(organizerWalletTransactions)
      .where(
        and(
          eq(organizerWalletTransactions.tenantId, tenantId),
          eq(organizerWalletTransactions.type, 'credit'),
          eq(organizerWalletTransactions.status, 'pending')
        )
      );

    let expectedEscrowBalance = 0;
    for (const tx of pendingWalletTxns) {
      expectedEscrowBalance += parseFloat(tx.amount);
    }

    const discrepancy = Math.abs(expectedEscrowBalance - Math.abs(ledgerBalance)) > 0.01;

    return {
      healthy: !discrepancy,
      ledgerBalance: ledgerBalance.toFixed(2),
      expectedBalance: expectedEscrowBalance.toFixed(2),
      discrepancyAmount: (expectedEscrowBalance - Math.abs(ledgerBalance)).toFixed(2),
      timestamp: new Date()
    };
  },

  /**
   * Run daily/on-demand inventory-reservations-booking-ledger reconciliation check
   */
  async reconcileInventoryAndLedger(tenantId: string, repair?: boolean): Promise<any> {
    const discrepancies: any[] = [];
    const summary = {
      checkedTicketTypesCount: 0,
      checkedBookingOrdersCount: 0,
      totalDiscrepancies: 0,
      timestamp: new Date()
    };

    // 1. Load all ticket types for the tenant
    const tickets = await db
      .select()
      .from(ticketTypes)
      .where(and(eq(ticketTypes.tenantId, tenantId), isNull(ticketTypes.deletedAt)))
      .orderBy(asc(ticketTypes.id));

    summary.checkedTicketTypesCount = tickets.length;

    // For each ticket type, compare cached quantities with derived quantities
    for (const ticket of tickets) {
      // derivedSoldQuantity: sum of quantity of bookingOrderItems where bookingOrder.status in ('confirmed', 'paid', 'completed')
      const [soldRow] = await db
        .select({
          soldQuantity: sql<number>`coalesce(sum(${bookingOrderItems.quantity}), 0)`
        })
        .from(bookingOrderItems)
        .innerJoin(
          bookingOrders,
          and(
            eq(bookingOrders.id, bookingOrderItems.bookingOrderId),
            eq(bookingOrders.tenantId, tenantId),
            isNull(bookingOrders.deletedAt),
            sql`${bookingOrders.status}::text in ('confirmed', 'paid', 'completed')`
          )
        )
        .where(and(eq(bookingOrderItems.tenantId, tenantId), eq(bookingOrderItems.ticketTypeId, ticket.id)));

      const derivedSold = Number(soldRow?.soldQuantity ?? 0);

      // derivedReservedQuantity: active reservations where expiresAt > now()
      const [reservedRow] = await db
        .select({
          reservedQuantity: sql<number>`coalesce(sum(${inventoryReservations.quantity}), 0)`
        })
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.tenantId, tenantId),
            eq(inventoryReservations.ticketTypeId, ticket.id),
            inArray(inventoryReservations.status, [
              'active',
              'created',
              'locking_inventory',
              'reserved',
              'payment_pending',
              'payment_started',
              'payment_processing',
              'payment_verified',
              'converting'
            ]),
            isNull(inventoryReservations.deletedAt),
            isNull(inventoryReservations.convertedAt),
            isNull(inventoryReservations.releasedAt),
            sql`${inventoryReservations.expiresAt} > now()`
          )
        );

      const derivedReserved = Number(reservedRow?.reservedQuantity ?? 0);

      if (ticket.soldQuantity !== derivedSold || ticket.reservedQuantity !== derivedReserved) {
        discrepancies.push({
          type: 'ticket_capacity_mismatch',
          ticketTypeId: ticket.id,
          message: `Ticket Type ${ticket.name} (${ticket.id}) capacity cache mismatch. Cached Sold: ${ticket.soldQuantity}, Derived Sold: ${derivedSold}. Cached Reserved: ${ticket.reservedQuantity}, Derived Reserved: ${derivedReserved}.`,
          cachedSold: ticket.soldQuantity,
          derivedSold,
          cachedReserved: ticket.reservedQuantity,
          derivedReserved
        });

        // Perform repair if requested
        if (repair) {
          await db
            .update(ticketTypes)
            .set({
              soldQuantity: derivedSold,
              reservedQuantity: derivedReserved,
              updatedAt: new Date()
            })
            .where(eq(ticketTypes.id, ticket.id));
        }
      }
    }

    // 2. Load all booking orders for the tenant
    const bookings = await db
      .select()
      .from(bookingOrders)
      .where(and(eq(bookingOrders.tenantId, tenantId), isNull(bookingOrders.deletedAt)))
      .orderBy(asc(bookingOrders.id));

    summary.checkedBookingOrdersCount = bookings.length;

    for (const booking of bookings) {
      // Find all reservations linked to this booking
      const reservations = await db
        .select()
        .from(inventoryReservations)
        .where(and(eq(inventoryReservations.bookingOrderId, booking.id), eq(inventoryReservations.tenantId, tenantId), isNull(inventoryReservations.deletedAt)))
        .orderBy(asc(inventoryReservations.id));

      // Check reservation status vs booking status
      if (['paid', 'confirmed', 'completed'].includes(booking.status)) {
        // Must have at least one reservation, and all reservations must be 'booked' or 'converted' or 'refunded'/'refund_pending' (if refunded later)
        if (reservations.length === 0) {
          discrepancies.push({
            type: 'booking_reservation_mismatch',
            bookingOrderId: booking.id,
            message: `Booking ${booking.id} has status '${booking.status}' but no associated inventory reservations.`
          });
        } else {
          const invalidReservations = reservations.filter(r => !['booked', 'converted', 'refund_pending', 'refunded'].includes(r.status));
          if (invalidReservations.length > 0) {
            discrepancies.push({
              type: 'booking_reservation_mismatch',
              bookingOrderId: booking.id,
              message: `Booking ${booking.id} has status '${booking.status}' but some reservations are in non-converted states: ${invalidReservations.map(r => `${r.id}(${r.status})`).join(', ')}.`
            });
          }
        }
      } else if (['expired', 'cancelled'].includes(booking.status)) {
        // Reservations must not be booked/converted or active. Must be expired/cancelled/released/refunded.
        const activeOrBookedRes = reservations.filter(r => ['booked', 'converted', 'active', 'reserved', 'payment_pending', 'payment_started', 'payment_processing', 'payment_verified', 'converting'].includes(r.status));
        if (activeOrBookedRes.length > 0) {
          discrepancies.push({
            type: 'booking_reservation_mismatch',
            bookingOrderId: booking.id,
            message: `Booking ${booking.id} is '${booking.status}' but has active or booked reservations: ${activeOrBookedRes.map(r => `${r.id}(${r.status})`).join(', ')}.`
          });
        }
      }

      // Check payment transactions vs ledger entries
      const capPayments = await db
        .select()
        .from(paymentTransactions)
        .where(and(
          eq(paymentTransactions.tenantId, tenantId),
          eq(paymentTransactions.status, 'captured'),
          sql`${paymentTransactions.paymentOrderId} IN (SELECT id FROM payment_orders WHERE booking_order_id = ${booking.id} AND tenant_id = ${tenantId})`
        ));

      for (const pay of capPayments) {
        // Check if there is a TICKET_PURCHASE_CAPTURE ledger transaction referencing this payment_transaction
        const ledgTx = await db
          .select()
          .from(ledgerTransactions)
          .where(and(
            eq(ledgerTransactions.tenantId, tenantId),
            eq(ledgerTransactions.referenceType, 'payment_transaction'),
            eq(ledgerTransactions.referenceId, pay.id),
            eq(ledgerTransactions.transactionType, 'TICKET_PURCHASE_CAPTURE')
          ))
          .limit(1)
          .then(res => res[0] ?? null);

        if (!ledgTx) {
          discrepancies.push({
            type: 'payment_ledger_missing',
            bookingOrderId: booking.id,
            paymentTransactionId: pay.id,
            message: `Captured payment transaction ${pay.id} for booking ${booking.id} has no matching ledger entry.`
          });
        } else {
          // Verify amount matches
          const ledgMinor = Math.round(parseFloat(ledgTx.amount) * 100);
          const payMinor = Math.round(parseFloat(pay.amount) * 100);
          if (ledgMinor !== payMinor) {
            discrepancies.push({
              type: 'payment_ledger_amount_mismatch',
              bookingOrderId: booking.id,
              paymentTransactionId: pay.id,
              message: `Ledger transaction amount (${ledgTx.amount}) doesn't match payment transaction amount (${pay.amount}).`
            });
          }
        }
      }

      // Check refund records vs ledger entries
      const refunds = await db
        .select()
        .from(paymentRefunds)
        .where(and(
          eq(paymentRefunds.tenantId, tenantId),
          inArray(paymentRefunds.status, ['pending', 'processed']),
          sql`${paymentRefunds.paymentTransactionId} IN (SELECT pt.id FROM payment_transactions pt INNER JOIN payment_orders po ON pt.payment_order_id = po.id WHERE po.booking_order_id = ${booking.id} AND po.tenant_id = ${tenantId})`
        ));

      for (const refund of refunds) {
        // Check if there is a ledger transaction referencing this payment_refund
        const ledgRefundTx = await db
          .select()
          .from(ledgerTransactions)
          .where(and(
            eq(ledgerTransactions.tenantId, tenantId),
            eq(ledgerTransactions.referenceType, 'payment_refund'),
            eq(ledgerTransactions.referenceId, refund.id)
          ))
          .limit(1)
          .then(res => res[0] ?? null);

        if (!ledgRefundTx) {
          discrepancies.push({
            type: 'refund_ledger_missing',
            bookingOrderId: booking.id,
            refundId: refund.id,
            message: `Refund record ${refund.id} for booking ${booking.id} has no matching ledger entry.`
          });
        } else {
          const ledgMinor = Math.round(parseFloat(ledgRefundTx.amount) * 100);
          const refMinor = Math.round(parseFloat(refund.amount) * 100);
          if (ledgMinor !== refMinor) {
            discrepancies.push({
              type: 'refund_ledger_amount_mismatch',
              bookingOrderId: booking.id,
              refundId: refund.id,
              message: `Ledger refund transaction amount (${ledgRefundTx.amount}) doesn't match refund record amount (${refund.amount}).`
            });
          }
        }
      }
    }

    summary.totalDiscrepancies = discrepancies.length;
    const runStatus = discrepancies.length > 0 ? 'discrepancies_found' : 'completed';

    const [record] = await db
      .insert(ledgerReconciliation)
      .values({
        tenantId,
        runType: 'inventory_financial',
        status: runStatus,
        summary,
        discrepancies
      })
      .returning();

    // Increment reconciliation metric if discrepancies exist
    if (discrepancies.length > 0) {
      const { incrementMetric } = await import('../../../lib/metrics.js');
      incrementMetric('ledger_reconciliation_failures_total');
    }

    return record;
  }
};
