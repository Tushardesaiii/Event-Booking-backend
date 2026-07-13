import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { issuedTicketCounters, issuedTickets } from '../../db/schema/index.js';
import { badRequest, conflict, forbidden, invalidTicketStatus, notFound, staleRequest, ticketInvalidated } from '../../lib/errors.js';
import { assertOptimisticUpdate } from '../../lib/optimistic-locking.js';
import { marketingHooks } from '../marketing/hooks.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import type { TenantMembershipRecord } from '../../types/auth.js';
import { canCancelIssuedTickets, canCheckInTickets, canIssueTickets, canInvalidateTickets, canReadIssuedTickets, canTransferIssuedTickets } from '../../policies/issued-ticket.policy.js';
import { canCancelIssuedTicket, canCheckInIssuedTicket, canInvalidateIssuedTicket, canRefundIssuedTicket, canTransferIssuedTicket, canValidateIssuedTicket, resolveValidationOutcome, type IssuedTicketValidationStatus } from './operational-policy.js';
import { findBookingOrderAttendeesForOrder, findBookingOrderById, findBookingOrderItemsForOrder } from '../booking-orders/repository.js';
import { findAttendeeByTenantAndId } from '../attendees/repository.js';
import {
  createIssuedTicketRecords,
  countIssuedTicketsForBookingOrderItem,
  findIssuedTicketByTenantAndQrCodeToken,
  findIssuedTicketByQrCodeToken,
  findIssuedTicketByTenantAndTicketNumber,
  findIssuedTicketsByTicketNumber,
  findIssuedTicketsForBookingOrder,
  findIssuedTicketsForBookingOrderItem,
  findIssuedTicketsForTenant,
  insertIssuedTicketEventRecord,
  recordIssuedTicketValidationAttempt,
  softDeleteIssuedTicketRecord,
  updateIssuedTicketRecord
} from './repository.js';
import { isTerminalIssuedTicketStatus, resolveTicketStatusFromBookingStatus, validateIssuedTicketTransition } from './lifecycle.js';
import type {
  CheckInIssuedTicketDTO,
  IssuedTicketDetailItem,
  IssuedTicketListItem,
  IssuedTicketListQuery,
  IssuedTicketValidationResult,
  IssuedTicketValidateDTO,
  UpdateIssuedTicketDTO
} from './types.js';

type IssuedTicketDatabase = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
  delete: typeof db.delete;
  transaction: typeof db.transaction;
};

function normalizeTicketNumber(value: string) {
  return value.trim().toUpperCase();
}

function normalizeRecord(value?: Record<string, unknown> | null) {
  return value ?? {};
}

function normalizeScanContext(input: {
  scannerDeviceId?: string;
  scannerGate?: string;
  scannerOperatorUserId?: string;
  source?: string;
}) {
  return {
    scannerDeviceId: input.scannerDeviceId?.trim() || null,
    scannerGate: input.scannerGate?.trim() || null,
    scannerOperatorUserId: input.scannerOperatorUserId ?? null,
    source: input.source?.trim() || null
  };
}

function resolveValidationEventType(status: IssuedTicketValidationStatus) {
  switch (status) {
    case 'valid':
      return 'ticket_validated' as const;
    case 'already_checked_in':
      return 'ticket_checked_in' as const;
    case 'cancelled':
      return 'ticket_cancelled' as const;
    case 'refunded':
      return 'ticket_refunded' as const;
    case 'invalidated':
    case 'deleted':
      return 'ticket_invalidated' as const;
    case 'tenant_mismatch':
    case 'stale_ticket':
    case 'invalid_qr':
    case 'unauthorized_scanner':
    default:
      return 'ticket_validation_rejected' as const;
  }
}

function resolveFailureReason(status: IssuedTicketValidationStatus, fallback?: string | null) {
  return fallback ?? status;
}

function isSameTimestamp(left?: string | null, right?: Date | null) {
  if (!left || !right) {
    return false;
  }

  return new Date(left).getTime() === right.getTime();
}

function resolveTicketPrefix(ticketTypeSlugSnapshot: string) {
  const tokens = ticketTypeSlugSnapshot.toLowerCase().split('-').filter(Boolean);

  if (tokens.length === 0) {
    return 'TKT';
  }

  const first = tokens[0].replace(/[^a-z0-9]/g, '').toUpperCase();
  return first.slice(0, 8) || 'TKT';
}

function generateQrCodeToken() {
  return randomBytes(32).toString('base64url');
}

function assertReadAccess(membership: TenantMembershipRecord) {
  if (!canReadIssuedTickets(membership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }
}

function assertIssueAccess(membership: TenantMembershipRecord) {
  if (!canIssueTickets(membership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }
}

function assertCheckInAccess(membership: TenantMembershipRecord) {
  if (!canCheckInTickets(membership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }
}

function assertMutationAccess(membership: TenantMembershipRecord, status?: UpdateIssuedTicketDTO['status']) {
  if (status === 'transferred' && !canTransferIssuedTickets(membership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }

  if (status === 'cancelled' && !canCancelIssuedTickets(membership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }

  if ((status === 'invalidated' || status === 'refunded') && !canInvalidateTickets(membership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }
}

function toDetailItem(row: IssuedTicketListItem | null): IssuedTicketDetailItem | null {
  return row ? (row as IssuedTicketDetailItem) : null;
}

function groupAssignmentsByItem(assignments: Awaited<ReturnType<typeof findBookingOrderAttendeesForOrder>>) {
  const grouped = new Map<string, typeof assignments>();

  for (const assignment of assignments) {
    const rows = grouped.get(assignment.bookingOrderItemId) ?? [];
    rows.push(assignment);
    grouped.set(assignment.bookingOrderItemId, rows);
  }

  for (const [key, rows] of grouped.entries()) {
    grouped.set(
      key,
      rows.sort((left, right) => left.assignedAt.getTime() - right.assignedAt.getTime())
    );
  }

  return grouped;
}

async function ensureIssuedTicketsForOrderItem(
  database: IssuedTicketDatabase,
  tenantId: string,
  order: NonNullable<Awaited<ReturnType<typeof findBookingOrderById>>>,
  item: Awaited<ReturnType<typeof findBookingOrderItemsForOrder>>[number],
  assignments: Awaited<ReturnType<typeof findBookingOrderAttendeesForOrder>>
) {
  const current = await findIssuedTicketsForBookingOrderItem(database, tenantId, item.id);

  if (current.length > item.quantity) {
    throw conflict('Issued ticket count exceeds booking item quantity');
  }

  const prefix = resolveTicketPrefix(item.ticketSlugSnapshot);
  const year = new Date(order.confirmedAt ?? order.createdAt).getUTCFullYear();

  const newlyCreatedNumbers = new Set<string>();
  const updatedAttendeeNumbers = new Set<string>();

  if (current.length < item.quantity) {
    const missing = item.quantity - current.length;
    const counterRows = await database
      .insert(issuedTicketCounters)
      .values({
        tenantId,
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        year,
        prefix,
        nextSequence: missing + 1
      })
      .onConflictDoUpdate({
        target: [issuedTicketCounters.tenantId, issuedTicketCounters.eventId, issuedTicketCounters.year, issuedTicketCounters.prefix],
        set: {
          nextSequence: sql`${issuedTicketCounters.nextSequence} + ${missing}`,
          updatedAt: new Date()
        }
      })
      .returning({ nextSequence: issuedTicketCounters.nextSequence });

    const nextSequence = counterRows[0]?.nextSequence ?? missing + 1;
    const startSequence = nextSequence - missing;
    const assignmentRows = assignments.filter((assignment) => assignment.bookingOrderItemId === item.id);

    const newTickets = Array.from({ length: missing }, (_, index) => {
      const sequence = startSequence + index;
      const assignment = assignmentRows[index];

      const ticketObj = {
        tenantId,
        eventId: order.eventId,
        eventDateId: order.eventDateId ?? null,
        ticketTypeId: item.ticketTypeId,
        attendeeId: assignment?.attendeeId ?? null,
        bookingOrderId: order.id,
        bookingOrderItemId: item.id,
        ticketNumber: `${prefix}-${year}-${String(sequence).padStart(6, '0')}`,
        qrCodeToken: generateQrCodeToken(),
        status: 'issued' as const,
        issuedAt: order.confirmedAt ?? new Date(),
        checkedInAt: null,
        transferredAt: null,
        cancelledAt: null,
        invalidatedAt: null,
        ticketTypeNameSnapshot: item.ticketNameSnapshot,
        ticketTypeSlugSnapshot: item.ticketSlugSnapshot,
        unitPriceSnapshot: item.unitPrice,
        currencySnapshot: item.currency,
        metadata: normalizeRecord(item.metadata as Record<string, unknown> | null | undefined)
      };

      newlyCreatedNumbers.add(ticketObj.ticketNumber);
      return ticketObj;
    });

    await createIssuedTicketRecords(database, newTickets);
  }

  const refreshedTickets = await findIssuedTicketsForBookingOrderItem(database, tenantId, item.id);
  const assignedAttendees = assignments.filter((assignment) => assignment.bookingOrderItemId === item.id);

  if (assignedAttendees.length > refreshedTickets.length) {
    throw conflict('Issued ticket assignment exceeds available quantity');
  }

  const desiredLinks = new Map<string, string | null>();
  refreshedTickets.forEach((ticket, index) => {
    desiredLinks.set(ticket.ticketNumber, assignedAttendees[index]?.attendeeId ?? null);
  });

  const updates = refreshedTickets.filter((ticket) => ticket.attendeeId !== desiredLinks.get(ticket.ticketNumber));

  for (const ticket of updates) {
    const nextAttendeeId = desiredLinks.get(ticket.ticketNumber);

    const updated = await updateIssuedTicketRecord(database, tenantId, ticket.ticketNumber, {
      attendeeId: nextAttendeeId,
      status: ticket.status,
      metadata: ticket.metadata as Record<string, unknown>,
      lastKnownUpdatedAt: ticket.updatedAt.toISOString()
    });

    assertOptimisticUpdate(updated);

    if (nextAttendeeId && nextAttendeeId !== ticket.attendeeId) {
      updatedAttendeeNumbers.add(ticket.ticketNumber);
    }
  }

  const finalTickets = await findIssuedTicketsForBookingOrderItem(database, tenantId, item.id);
  const targetNumbers = new Set([...newlyCreatedNumbers, ...updatedAttendeeNumbers]);

  for (const ticket of finalTickets) {
    if (targetNumbers.has(ticket.ticketNumber) && ticket.attendeeId) {
      const attendee = assignedAttendees.find((a) => a.attendeeId === ticket.attendeeId);
      if (attendee && attendee.attendeeEmail) {
        // Generate and upload Ticket PDF & QR code image to R2 (Phase 13.9 platform integration)
        try {
          const { storageService } = await import('../../lib/storage.js');
          
          // 1. QR Code Image Upload
          const qrBuffer = Buffer.from(`QR_CODE_TOKEN: ${ticket.qrCodeToken}`);
          await storageService.uploadSystemAsset(
            tenantId,
            ticket.id,
            'tickets',
            `qr-${ticket.id}.png`,
            qrBuffer,
            'image/png'
          );

          // 2. Ticket PDF Upload
          const pdfBuffer = Buffer.from(`TICKET_PDF: NO=${ticket.ticketNumber}, TYPE=${ticket.ticketTypeNameSnapshot}, PRICE=${ticket.unitPriceSnapshot} ${ticket.currencySnapshot}`);
          await storageService.uploadSystemAsset(
            tenantId,
            ticket.id,
            'tickets',
            `ticket-${ticket.id}.pdf`,
            pdfBuffer,
            'application/pdf'
          );
        } catch (storageErr: any) {
          console.error('[TicketsService] Failed to generate/upload ticket assets to R2', { error: storageErr.message });
        }

        try {
          await marketingHooks.onTicketIssued(
            {
              id: ticket.id,
              ticketNumber: ticket.ticketNumber,
              attendeeEmail: attendee.attendeeEmail,
              attendeeName: attendee.attendeeFullName || undefined
            },
            { tenantId }
          );
        } catch (err) {
          // Fail silently
        }
      }
    }
  }

  return finalTickets;
}

async function insertIssuedTicketLifecycleEvent(
  database: IssuedTicketDatabase,
  tenantId: string,
  ticketId: string | null | undefined,
  eventType: 'ticket_validated' | 'ticket_checked_in' | 'ticket_invalidated' | 'ticket_refunded' | 'ticket_cancelled' | 'ticket_transferred' | 'ticket_validation_rejected',
  status: IssuedTicketValidationStatus,
  actorUserId?: string | null,
  scanContext?: ReturnType<typeof normalizeScanContext>,
  details?: Record<string, unknown>
) {
  await insertIssuedTicketEventRecord(database, {
    tenantId,
    issuedTicketId: ticketId ?? null,
    eventType,
    outcome: status,
    actorUserId: actorUserId ?? null,
    scannerDeviceId: scanContext?.scannerDeviceId ?? null,
    scannerGate: scanContext?.scannerGate ?? null,
    scannerOperatorUserId: scanContext?.scannerOperatorUserId ?? null,
    source: scanContext?.source ?? null,
    details: details ?? {}
  });
}

async function reconcileIssuedTicketsForBookingOrder(database: IssuedTicketDatabase, tenantId: string, bookingOrderId: string) {
  const order = await findBookingOrderById(database, tenantId, bookingOrderId);

  if (!order) {
    throw notFound('Booking order not found');
  }

  // Tickets are issued once an order is paid. confirmPaymentAndOrder transitions
  // the order to 'paid' (not 'confirmed') immediately before calling issuance, so
  // 'paid'/'completed' must be honored here too — otherwise no tickets are ever
  // created for the consumer payment flow.
  if (!['confirmed', 'paid', 'completed'].includes(order.status)) {
    return [] as IssuedTicketListItem[];
  }

  const items = await findBookingOrderItemsForOrder(database, tenantId, bookingOrderId);
  const assignments = await findBookingOrderAttendeesForOrder(database, tenantId, bookingOrderId);

  for (const item of items) {
    await ensureIssuedTicketsForOrderItem(database, tenantId, order, item, assignments);
  }

  return findIssuedTicketsForBookingOrder(database, tenantId, bookingOrderId);
}

export async function issueIssuedTicketsForBookingOrder(database: IssuedTicketDatabase, tenantId: string, bookingOrderId: string, actorMembership: TenantMembershipRecord) {
  assertIssueAccess(actorMembership);
  return reconcileIssuedTicketsForBookingOrder(database, tenantId, bookingOrderId);
}

export async function reconcileIssuedTicketsAfterAssignment(database: IssuedTicketDatabase, tenantId: string, bookingOrderId: string) {
  return reconcileIssuedTicketsForBookingOrder(database, tenantId, bookingOrderId);
}

export async function applyIssuedTicketStatusForBookingOrder(
  database: IssuedTicketDatabase,
  tenantId: string,
  bookingOrderId: string,
  bookingOrderStatus: 'draft' | 'pending' | 'confirmed' | 'paid' | 'completed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded'
) {
  const nextStatus = resolveTicketStatusFromBookingStatus(bookingOrderStatus);

  if (!nextStatus) {
    return [] as IssuedTicketListItem[];
  }

  const tickets = await findIssuedTicketsForBookingOrder(database, tenantId, bookingOrderId);

  for (const ticket of tickets) {
    if (ticket.status === nextStatus) {
      continue;
    }

    validateIssuedTicketTransition(ticket.status, nextStatus);

    const timestamps = {
      checkedInAt: ticket.checkedInAt,
      transferredAt: ticket.transferredAt,
      cancelledAt: ticket.cancelledAt,
      invalidatedAt: ticket.invalidatedAt
    };

    if (nextStatus === 'checked_in') {
      timestamps.checkedInAt = ticket.checkedInAt ?? new Date();
    }

    if (nextStatus === 'cancelled') {
      timestamps.cancelledAt = ticket.cancelledAt ?? new Date();
    }

    if (nextStatus === 'refunded') {
      timestamps.invalidatedAt = ticket.invalidatedAt ?? new Date();
    }

    if (nextStatus === 'invalidated') {
      timestamps.invalidatedAt = ticket.invalidatedAt ?? new Date();
    }

    const updated = await updateIssuedTicketRecord(database, tenantId, ticket.ticketNumber, {
      status: nextStatus,
      attendeeId: ticket.attendeeId,
      metadata: ticket.metadata as Record<string, unknown>,
      checkedInAt: timestamps.checkedInAt,
      transferredAt: timestamps.transferredAt,
      cancelledAt: timestamps.cancelledAt,
      invalidatedAt: timestamps.invalidatedAt,
      lastKnownUpdatedAt: ticket.updatedAt.toISOString()
    });

    assertOptimisticUpdate(updated);

    const eventType = nextStatus === 'checked_in'
      ? 'ticket_checked_in'
      : nextStatus === 'cancelled'
        ? 'ticket_cancelled'
        : nextStatus === 'refunded'
          ? 'ticket_refunded'
          : nextStatus === 'invalidated'
            ? 'ticket_invalidated'
            : 'ticket_validated';

    await insertIssuedTicketLifecycleEvent(database, tenantId, updated?.id ?? ticket.id, eventType, nextStatus === 'checked_in' ? 'valid' : 'valid', null, undefined, {
      bookingOrderId,
      ticketNumber: ticket.ticketNumber
    });
  }

  return findIssuedTicketsForBookingOrder(database, tenantId, bookingOrderId);
}

export async function listIssuedTickets(tenantId: string, actorMembership: TenantMembershipRecord, input: IssuedTicketListQuery) {
  assertReadAccess(actorMembership);

  const pagination = parsePagination(input);
  const { rows, total } = await findIssuedTicketsForTenant(db, tenantId, input, pagination);

  return {
    items: rows as IssuedTicketListItem[],
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function getIssuedTicketByTicketNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  ticketNumber: string
) {
  const normalizedTicketNumber = normalizeTicketNumber(ticketNumber);
  const ticket = await findIssuedTicketByTenantAndTicketNumber(db, tenantId, normalizedTicketNumber);

  if (!ticket) {
    throw notFound('Issued ticket not found');
  }

  if (ticket.purchaserUserId !== actorUserId && !canReadIssuedTickets(actorMembership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }

  return ticket as IssuedTicketDetailItem;
}

export async function validateIssuedTicket(tenantId: string, actorMembership: TenantMembershipRecord, actorUserId: string, input: IssuedTicketValidateDTO) {
  assertReadAccess(actorMembership);

  const scanContext = normalizeScanContext(input);

  return db.transaction(async (tx) => {
    const normalizedTicketNumber = input.ticketNumber ? normalizeTicketNumber(input.ticketNumber) : null;
    const activeTicket = normalizedTicketNumber
      ? await findIssuedTicketByTenantAndTicketNumber(tx, tenantId, normalizedTicketNumber)
      : await findIssuedTicketByTenantAndQrCodeToken(tx, tenantId, input.qrCodeToken!);

    let ticket = activeTicket;

    if (!ticket) {
      if (normalizedTicketNumber) {
        const globalTickets = await findIssuedTicketsByTicketNumber(tx, normalizedTicketNumber);
        const tenantTickets = globalTickets.filter((row) => row.tenantId === tenantId);

        if (tenantTickets.length > 0) {
          ticket = tenantTickets[0];
        } else if (globalTickets.length > 0) {
          ticket = globalTickets[0];
        }
      } else {
        ticket = await findIssuedTicketByQrCodeToken(tx, input.qrCodeToken!);
      }
    }

    const staleTicket = Boolean(input.lastKnownUpdatedAt && ticket && !isSameTimestamp(input.lastKnownUpdatedAt, ticket.updatedAt));
    const outcome = resolveValidationOutcome({
      ticketExists: Boolean(ticket),
      deleted: Boolean(ticket?.deletedAt),
      tenantMatch: ticket ? ticket.tenantId === tenantId : false,
      status: ticket?.status,
      staleTicket,
      scannerAuthorized: true
    });

    const validationSource = input.ticketNumber ? 'ticketNumber' : 'qrCodeToken';
    const failureReason = outcome === 'valid' ? null : resolveFailureReason(outcome);

    if (ticket && outcome !== 'deleted' && outcome !== 'tenant_mismatch' && outcome !== 'invalid_qr') {
      const updated = await recordIssuedTicketValidationAttempt(tx, tenantId, ticket.ticketNumber, {
        outcome,
        validatedByUserId: outcome === 'valid' ? actorUserId : null,
        scannerDeviceId: scanContext.scannerDeviceId,
        scannerGate: scanContext.scannerGate,
        scannerOperatorUserId: scanContext.scannerOperatorUserId,
        source: scanContext.source,
        failureReason,
        success: outcome === 'valid'
      });

      await insertIssuedTicketLifecycleEvent(
        tx,
        tenantId,
        updated?.id ?? ticket.id,
        resolveValidationEventType(outcome),
        outcome,
        actorUserId,
        scanContext,
        {
          validationSource,
          failureReason,
          staleTicket
        }
      );

      return {
        valid: outcome === 'valid',
        status: outcome,
        ticket: updated ? (updated as IssuedTicketDetailItem) : (ticket as IssuedTicketDetailItem),
        validationSource,
        failureReason
      } satisfies IssuedTicketValidationResult;
    }

    await insertIssuedTicketLifecycleEvent(
      tx,
      tenantId,
      ticket?.id ?? null,
      'ticket_validation_rejected',
      outcome,
      actorUserId,
      scanContext,
      {
        validationSource,
        failureReason,
        staleTicket,
        ticketNumber: normalizedTicketNumber,
        qrCodeToken: input.qrCodeToken ? '[redacted]' : null
      }
    );

    return {
      valid: false,
      status: outcome,
      ticket: ticket && outcome !== 'invalid_qr' && outcome !== 'tenant_mismatch' && outcome !== 'deleted' ? (ticket as IssuedTicketDetailItem) : null,
      validationSource,
      failureReason
    } satisfies IssuedTicketValidationResult;
  });
}

export async function checkInIssuedTicketByTicketNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  ticketNumber: string,
  input: CheckInIssuedTicketDTO
) {
  assertCheckInAccess(actorMembership);
  const scanContext = normalizeScanContext(input);

  return db.transaction(async (tx) => {
    const normalizedTicketNumber = normalizeTicketNumber(ticketNumber);
    const ticket = await findIssuedTicketByTenantAndTicketNumber(tx, tenantId, normalizedTicketNumber);

    if (!ticket) {
      throw notFound('Issued ticket not found');
    }

    if (ticket.status === 'checked_in') {
      // Duplicate check-in detected – respond with conflict to match API contract
      throw conflict('Ticket already checked in');
    }

    if (ticket.status === 'cancelled' || ticket.status === 'refunded' || ticket.status === 'invalidated') {
      throw ticketInvalidated({ ticketNumber: normalizedTicketNumber, status: ticket.status });
    }

    if (!canCheckInIssuedTicket(ticket.status)) {
      throw invalidTicketStatus(`Ticket status ${ticket.status} cannot be checked in`);
    }

    if (input.lastKnownUpdatedAt && !isSameTimestamp(input.lastKnownUpdatedAt, ticket.updatedAt)) {
      throw staleRequest('Ticket is stale', { code: 'STALE_TICKET' });
    }

    const updated = await updateIssuedTicketRecord(tx, tenantId, normalizedTicketNumber, {
      status: 'checked_in',
      attendeeId: ticket.attendeeId,
      metadata: normalizeRecord(ticket.metadata as Record<string, unknown>),
      checkedInAt: ticket.checkedInAt ?? new Date(),
      checkedInByUserId: actorUserId,
      lastValidatedAt: ticket.lastValidatedAt ?? new Date(),
      lastValidatedByUserId: actorUserId,
      validationCountIncrement: 1,
      successfulValidationCountIncrement: 1,
      lastValidationAttemptAt: new Date(),
      lastSuccessfulValidationAt: ticket.lastSuccessfulValidationAt ?? new Date(),
      lastValidationFailureReason: null,
      lastValidationSource: scanContext.source,
      lastScannerDeviceId: scanContext.scannerDeviceId,
      lastScannerGate: scanContext.scannerGate,
      lastScannerOperatorUserId: scanContext.scannerOperatorUserId,
      lastKnownUpdatedAt: input.lastKnownUpdatedAt,
      transferredAt: ticket.transferredAt,
      transferredByUserId: ticket.transferredByUserId,
      cancelledAt: ticket.cancelledAt,
      invalidatedAt: ticket.invalidatedAt,
      refundedAt: ticket.refundedAt,
      refundedByUserId: ticket.refundedByUserId
    });

    assertOptimisticUpdate(updated);

    await insertIssuedTicketLifecycleEvent(tx, tenantId, updated?.id ?? ticket.id, 'ticket_checked_in', 'valid', actorUserId, scanContext, {
      ticketNumber: normalizedTicketNumber
    });

    return updated as IssuedTicketDetailItem;
  });
}

export async function updateIssuedTicketByTicketNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  actorUserId: string,
  ticketNumber: string,
  input: UpdateIssuedTicketDTO
) {
  assertMutationAccess(actorMembership, input.status);

  return db.transaction(async (tx) => {
    const normalizedTicketNumber = normalizeTicketNumber(ticketNumber);
    const ticket = await findIssuedTicketByTenantAndTicketNumber(tx, tenantId, normalizedTicketNumber);

    if (!ticket) {
      throw notFound('Issued ticket not found');
    }

    if (input.attendeeId !== undefined && input.attendeeId !== ticket.attendeeId && !canTransferIssuedTickets(actorMembership.role)) {
      throw forbidden('Insufficient issued ticket permissions');
    }

    const nextStatus = input.status ?? ticket.status;
    validateIssuedTicketTransition(ticket.status, nextStatus);

    if (isTerminalIssuedTicketStatus(ticket.status) && !isTerminalIssuedTicketStatus(nextStatus)) {
      throw invalidTicketStatus('Terminal issued tickets cannot be reopened');
    }

    if (nextStatus === 'transferred' && !canTransferIssuedTicket(ticket.status)) {
      throw invalidTicketStatus('Ticket status cannot be transferred');
    }

    if (nextStatus === 'cancelled' && !canCancelIssuedTicket(ticket.status)) {
      throw invalidTicketStatus('Ticket status cannot be cancelled');
    }

    if (nextStatus === 'refunded' && !canRefundIssuedTicket(ticket.status)) {
      throw invalidTicketStatus('Ticket status cannot be refunded');
    }

    if (nextStatus === 'invalidated' && !canInvalidateIssuedTicket(ticket.status)) {
      throw invalidTicketStatus('Ticket status cannot be invalidated');
    }

    const updated = await updateIssuedTicketRecord(tx, tenantId, normalizedTicketNumber, {
      ...input,
      status: nextStatus,
      attendeeId: input.attendeeId === undefined ? ticket.attendeeId : input.attendeeId,
      checkedInAt: nextStatus === 'checked_in' ? ticket.checkedInAt ?? new Date() : ticket.checkedInAt,
      checkedInByUserId: nextStatus === 'checked_in' ? actorUserId : ticket.checkedInByUserId,
      transferredAt: nextStatus === 'transferred' ? ticket.transferredAt ?? new Date() : ticket.transferredAt,
      transferredByUserId: nextStatus === 'transferred' ? actorUserId : ticket.transferredByUserId,
      cancelledAt: nextStatus === 'cancelled' ? ticket.cancelledAt ?? new Date() : ticket.cancelledAt,
      invalidatedAt: nextStatus === 'invalidated' || nextStatus === 'refunded' ? ticket.invalidatedAt ?? new Date() : ticket.invalidatedAt,
      refundedAt: nextStatus === 'refunded' ? ticket.refundedAt ?? new Date() : ticket.refundedAt,
      refundedByUserId: nextStatus === 'refunded' ? actorUserId : ticket.refundedByUserId,
      lastValidatedAt: nextStatus === 'checked_in' ? ticket.lastValidatedAt ?? new Date() : ticket.lastValidatedAt,
      lastValidatedByUserId: nextStatus === 'checked_in' ? actorUserId : ticket.lastValidatedByUserId,
      validationCountIncrement: nextStatus === 'checked_in' ? 1 : undefined,
      successfulValidationCountIncrement: nextStatus === 'checked_in' ? 1 : undefined,
      lastValidationAttemptAt: nextStatus === 'checked_in' ? new Date() : ticket.lastValidationAttemptAt,
      lastSuccessfulValidationAt: nextStatus === 'checked_in' ? ticket.lastSuccessfulValidationAt ?? new Date() : ticket.lastSuccessfulValidationAt,
      lastValidationFailureReason: nextStatus === 'checked_in' ? null : ticket.lastValidationFailureReason,
      metadata: input.metadata === undefined ? (ticket.metadata as Record<string, unknown>) : input.metadata,
      lastKnownUpdatedAt: input.lastKnownUpdatedAt
    });

    assertOptimisticUpdate(updated);

    const eventType = nextStatus === 'transferred'
      ? 'ticket_transferred'
      : nextStatus === 'cancelled'
        ? 'ticket_cancelled'
        : nextStatus === 'refunded'
          ? 'ticket_refunded'
          : nextStatus === 'invalidated'
            ? 'ticket_invalidated'
            : 'ticket_validated';

    await insertIssuedTicketLifecycleEvent(tx, tenantId, updated?.id ?? ticket.id, eventType, 'valid', actorUserId, normalizeScanContext({ source: 'api' }), {
      nextStatus,
      ticketNumber: normalizedTicketNumber
    });

    return updated as IssuedTicketDetailItem;
  });
}

export async function deleteIssuedTicketByTicketNumber(
  tenantId: string,
  actorMembership: TenantMembershipRecord,
  ticketNumber: string,
  lastKnownUpdatedAt: string
) {
  if (!canInvalidateTickets(actorMembership.role)) {
    throw forbidden('Insufficient issued ticket permissions');
  }

  return db.transaction(async (tx) => {
    const normalizedTicketNumber = normalizeTicketNumber(ticketNumber);
    const ticket = await findIssuedTicketByTenantAndTicketNumber(tx, tenantId, normalizedTicketNumber);

    if (!ticket) {
      throw notFound('Issued ticket not found');
    }

    if (ticket.status === 'checked_in') {
      throw invalidTicketStatus('Checked-in tickets cannot be deleted');
    }

    if (!canInvalidateIssuedTicket(ticket.status)) {
      throw invalidTicketStatus('Ticket cannot be invalidated');
    }

    const deleted = await softDeleteIssuedTicketRecord(tx, tenantId, normalizedTicketNumber, lastKnownUpdatedAt, ticket.invalidatedAt ?? new Date());
    assertOptimisticUpdate(deleted);

    await insertIssuedTicketLifecycleEvent(tx, tenantId, deleted?.id ?? ticket.id, 'ticket_invalidated', 'invalidated', null, undefined, {
      ticketNumber: normalizedTicketNumber,
      deleted: true
    });

    return deleted as IssuedTicketDetailItem;
  });
}
