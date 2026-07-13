import { sql, and, eq, isNull, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { buildPaginationMeta, parsePagination } from '../../lib/pagination.js';
import { assertOptimisticUpdate, optimisticLockCondition } from '../../lib/optimistic-locking.js';
import { createInAppNotification } from '../notifications/service.js';
import { createBookingOrder, updateBookingOrderByOrderNumber } from '../booking-orders/service.js';
import { findBookingOrderById, findBookingOrderItemsForOrder } from '../booking-orders/repository.js';
import { createAttendeeRecord, findAttendeeByTenantAndId } from '../attendees/repository.js';
import {
  findActiveAssignmentForAttendee,
  softDeleteBookingOrderItemAssignmentRecord,
  countActiveAssignmentsForItem,
  createBookingOrderItemAssignmentRecord,
  findBookingOrderAttendeesForOrder
} from '../booking-orders/repository.js';
import { reconcileIssuedTicketsAfterAssignment } from '../issued-tickets/service.js';

import {
  findGroupBookingById,
  createGroupBookingRecord,
  updateGroupBookingRecord,
  listGroupBookings,
  findGroupBookingMember,
  addGroupBookingMember,
  updateGroupBookingMemberRecord,
  removeGroupBookingMember,
  listGroupBookingMembers,
  getGroupBookingMembersCount,
  createGroupBookingActivityRecord,
  listGroupBookingActivity
} from './repository.js';

import type {
  GroupBookingDetailItem
} from './types.js';

import type {
  CreateGroupBookingInput,
  InviteMemberInput,
  UpdateShareInput,
  RecordContributionInput,
  GroupBookingCancelInput,
  GroupBookingListQueryInput,
  GroupBookingActivityQueryInput
} from './validation.js';

import { groupBookings, groupBookingMembers } from './schema.js';
import { bookingOrderItemAttendees } from '../../db/schema/index.js';

async function assertMember(tx: any, groupBookingId: string, userId: string) {
  const member = await findGroupBookingMember(tx, groupBookingId, userId);
  if (!member) {
    throw forbidden('You are not a member of this group booking');
  }
  return member;
}

export async function checkAndProcessExpiration(
  tx: any,
  tenantId: string,
  booking: any
) {
  if (
    ['active', 'draft'].includes(booking.status) &&
    booking.expiresAt &&
    new Date(booking.expiresAt) < new Date()
  ) {
    const [expiredBooking] = await tx
      .update(groupBookings)
      .set({
        status: 'expired',
        version: sql`${groupBookings.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(eq(groupBookings.id, booking.id), eq(groupBookings.version, booking.version)))
      .returning();

    if (expiredBooking) {
      const order = await findBookingOrderById(tx, tenantId, booking.bookingOrderId);
      if (order && !['cancelled', 'expired'].includes(order.status)) {
        await updateBookingOrderByOrderNumber(
          tenantId,
          { role: 'owner' } as any,
          booking.createdByUserId,
          order.orderNumber,
          {
            status: 'expired',
            lastKnownUpdatedAt: order.updatedAt.toISOString()
          }
        );
      }

      await createGroupBookingActivityRecord(
        tx,
        booking.id,
        null,
        'booking_expired',
        { reason: 'Expiration deadline reached' }
      );

      const members = await listGroupBookingMembers(tx, booking.id);
      for (const member of members) {
        if (member.inviteStatus === 'accepted') {
          await createInAppNotification({
            tenantId,
            userId: member.userId,
            title: 'Group Booking Expired',
            message: `The group booking "${booking.title}" has expired as it did not receive full payment in time.`,
            type: 'group_booking_expired',
            entityType: 'group_booking',
            entityId: booking.id,
            metadata: { groupBookingId: booking.id, title: booking.title }
          });
        }
      }

      return expiredBooking;
    }
  }
  return booking;
}

export async function createGroupBooking(
  tenantId: string,
  userId: string,
  input: CreateGroupBookingInput
) {
  return db.transaction(async (tx) => {
    const bookingOrder = await createBookingOrder(
      tenantId,
      { role: 'owner' } as any,
      userId,
      {
        eventId: input.eventId,
        purchaserUserId: userId,
        status: 'pending',
        items: input.ticketSelections,
        discountAmount: 0,
        source: 'web'
      }
    );

    const expiresAt = bookingOrder.expiresAt ? new Date(bookingOrder.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const title = input.title || `Group Booking for ${bookingOrder.orderNumber}`;

    const booking = await createGroupBookingRecord(tx, {
      tenantId,
      eventId: input.eventId,
      bookingOrderId: bookingOrder.id,
      createdByUserId: userId,
      title,
      status: 'active',
      totalAmount: bookingOrder.totalAmount,
      collectedAmount: '0.00',
      expiresAt
    });

    if (!booking) {
      throw conflict('Unable to create group booking');
    }

    await addGroupBookingMember(tx, {
      groupBookingId: booking.id,
      userId,
      role: 'owner',
      inviteStatus: 'accepted',
      contributionAmount: booking.totalAmount,
      paidAmount: '0.00',
      joinedAt: new Date()
    });

    await createGroupBookingActivityRecord(tx, booking.id, userId, 'created', {
      title: booking.title,
      totalAmount: booking.totalAmount
    });

    return booking;
  });
}

export async function getGroupBooking(
  tenantId: string,
  id: string,
  userId: string
): Promise<GroupBookingDetailItem> {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);

    await assertMember(tx, booking.id, userId);

    const members = await listGroupBookingMembers(tx, booking.id);

    return {
      ...booking,
      members
    };
  });
}

export async function listGroupBookingsService(
  tenantId: string,
  userId: string,
  input: GroupBookingListQueryInput
) {
  const pagination = parsePagination(input);

  return db.transaction(async (tx) => {
    const { rows, total } = await listGroupBookings(
      tx,
      tenantId,
      { userId, status: input.status, eventId: input.eventId },
      pagination
    );

    const bookingIds = rows.map((r: any) => r.id);
    const membersCountMap = new Map<string, number>();

    if (bookingIds.length > 0) {
      const counts = await tx
        .select({
          groupBookingId: groupBookingMembers.groupBookingId,
          count: sql<number>`count(*)::int`
        })
        .from(groupBookingMembers)
        .where(
          and(
            inArray(groupBookingMembers.groupBookingId, bookingIds),
            eq(groupBookingMembers.inviteStatus, 'accepted'),
            isNull(groupBookingMembers.deletedAt)
          )
        )
        .groupBy(groupBookingMembers.groupBookingId);

      for (const c of counts) {
        membersCountMap.set(c.groupBookingId, c.count);
      }
    }

    const items = await Promise.all(
      rows.map(async (row: any) => {
        const updatedRow = await checkAndProcessExpiration(tx, tenantId, row);
        const membersCount = membersCountMap.get(updatedRow.id) || 0;
        return {
          ...updatedRow,
          membersCount
        };
      })
    );

    return {
      items,
      meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
    };
  });
}

export async function inviteMember(
  tenantId: string,
  id: string,
  actorUserId: string,
  input: InviteMemberInput
) {
  const inviteeUserId = input.userId;
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (booking.status !== 'active') {
      throw badRequest('Invitations can only be sent for active group bookings');
    }

    const actorMember = await assertMember(tx, booking.id, actorUserId);
    if (actorMember.role !== 'owner') {
      throw forbidden('Only the group booking owner can invite members');
    }

    const existing = await findGroupBookingMember(tx, booking.id, inviteeUserId);
    if (existing) {
      if (existing.inviteStatus === 'declined') {
        const updated = await updateGroupBookingMemberRecord(tx, existing.id, {
          inviteStatus: 'invited',
          contributionAmount: '0.00',
          paidAmount: '0.00',
          joinedAt: null
        });

        await createGroupBookingActivityRecord(tx, booking.id, actorUserId, 'member_invited', {
          inviteeUserId
        });

        await createInAppNotification({
          tenantId,
          userId: inviteeUserId,
          title: 'Group Booking Invitation',
          message: `You have been invited to join the group booking "${booking.title}"`,
          type: 'invited_to_group',
          entityType: 'group_booking',
          entityId: booking.id,
          metadata: { groupBookingId: booking.id, title: booking.title }
        });

        return updated;
      }
      throw conflict('User is already a member or has a pending invitation');
    }

    const member = await addGroupBookingMember(tx, {
      groupBookingId: booking.id,
      userId: inviteeUserId,
      role: 'member',
      inviteStatus: 'invited',
      contributionAmount: '0.00',
      paidAmount: '0.00'
    });

    await createGroupBookingActivityRecord(tx, booking.id, actorUserId, 'member_invited', {
      inviteeUserId
    });

    await createInAppNotification({
      tenantId,
      userId: inviteeUserId,
      title: 'Group Booking Invitation',
      message: `You have been invited to join the group booking "${booking.title}"`,
      type: 'invited_to_group',
      entityType: 'group_booking',
      entityId: booking.id,
      metadata: { groupBookingId: booking.id, title: booking.title }
    });

    return member;
  });
}

export async function acceptInvitation(
  tenantId: string,
  id: string,
  userId: string
) {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (booking.status !== 'active') {
      throw badRequest('Invitations can only be accepted for active group bookings');
    }

    const member = await findGroupBookingMember(tx, booking.id, userId);
    if (!member || member.inviteStatus !== 'invited') {
      throw badRequest('No pending invitation found for this user');
    }

    const updated = await updateGroupBookingMemberRecord(tx, member.id, {
      inviteStatus: 'accepted',
      joinedAt: new Date()
    });

    await createGroupBookingActivityRecord(tx, booking.id, userId, 'member_joined', {});

    await createInAppNotification({
      tenantId,
      userId: booking.createdByUserId,
      title: 'Invitation Accepted',
      message: `A member has accepted your invitation to join "${booking.title}"`,
      type: 'invite_accepted',
      entityType: 'group_booking',
      entityId: booking.id,
      metadata: { groupBookingId: booking.id, title: booking.title, userId }
    });

    return updated;
  });
}

export async function declineInvitation(
  tenantId: string,
  id: string,
  userId: string
) {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (booking.status !== 'active') {
      throw badRequest('Invitations can only be declined for active group bookings');
    }

    const member = await findGroupBookingMember(tx, booking.id, userId);
    if (!member || member.inviteStatus !== 'invited') {
      throw badRequest('No pending invitation found for this user');
    }

    const updated = await updateGroupBookingMemberRecord(tx, member.id, {
      inviteStatus: 'declined'
    });

    await createGroupBookingActivityRecord(tx, booking.id, userId, 'member_declined', {});

    return updated;
  });
}

export async function removeMember(
  tenantId: string,
  id: string,
  actorUserId: string,
  userIdToRemove: string,
  lastKnownUpdatedAt?: string
) {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (booking.status !== 'active') {
      throw badRequest('Members can only be removed from active group bookings');
    }

    if (lastKnownUpdatedAt) {
      const updatedBooking = await updateGroupBookingRecord(tx, tenantId, id, {
        lastKnownUpdatedAt
      });
      assertOptimisticUpdate(updatedBooking);
    }

    const actorMember = await assertMember(tx, booking.id, actorUserId);
    if (actorMember.role !== 'owner') {
      throw forbidden('Only the group booking owner can remove members');
    }

    const memberToRemove = await findGroupBookingMember(tx, booking.id, userIdToRemove);
    if (!memberToRemove) {
      throw notFound('Member to remove not found');
    }

    if (memberToRemove.role === 'owner') {
      throw badRequest('Cannot remove the owner of the group booking');
    }

    if (Number(memberToRemove.paidAmount) > 0) {
      throw badRequest('Cannot remove member who has already contributed payments');
    }

    const owner = await findGroupBookingMember(tx, booking.id, booking.createdByUserId);
    if (owner) {
      const newOwnerContribution = Number(owner.contributionAmount) + Number(memberToRemove.contributionAmount);
      await updateGroupBookingMemberRecord(tx, owner.id, {
        contributionAmount: newOwnerContribution.toFixed(2)
      });
    }

    await removeGroupBookingMember(tx, booking.id, userIdToRemove);

    await createGroupBookingActivityRecord(tx, booking.id, actorUserId, 'member_removed', {
      removedUserId: userIdToRemove
    });

    return { success: true };
  });
}

export async function updateShares(
  tenantId: string,
  id: string,
  actorUserId: string,
  input: UpdateShareInput
) {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (booking.status !== 'active') {
      throw badRequest('Shares can only be updated for active group bookings');
    }

    const updatedBooking = await updateGroupBookingRecord(tx, tenantId, id, {
      lastKnownUpdatedAt: input.lastKnownUpdatedAt
    });
    assertOptimisticUpdate(updatedBooking);

    const actorMember = await assertMember(tx, booking.id, actorUserId);
    if (actorMember.role !== 'owner') {
      throw forbidden('Only the group booking owner can reallocate contribution shares');
    }

    const members = await listGroupBookingMembers(tx, booking.id);
    const membersMap = new Map<string, any>(members.map((m: any) => [m.userId, m]));

    let totalSharesInput = 0;
    for (const share of input.shares) {
      totalSharesInput += share.amount;
      const member = membersMap.get(share.userId);
      if (!member) {
        throw badRequest(`User ${share.userId} is not a member of this group booking`);
      }
      if (member.inviteStatus !== 'accepted') {
        throw badRequest(`User ${share.userId} has not accepted the invitation yet`);
      }
      if (share.amount < Number(member.paidAmount)) {
        throw badRequest(`New share amount for user ${share.userId} cannot be less than their paid amount of ${member.paidAmount}`);
      }
    }

    const tolerance = 0.01;
    if (Math.abs(totalSharesInput - Number(booking.totalAmount)) > tolerance) {
      throw badRequest(`The sum of all shares (${totalSharesInput}) must exactly equal the booking order's total amount (${booking.totalAmount})`);
    }

    for (const share of input.shares) {
      const member = membersMap.get(share.userId)!;
      await updateGroupBookingMemberRecord(tx, member.id, {
        contributionAmount: share.amount.toFixed(2)
      });
    }

    await createGroupBookingActivityRecord(tx, booking.id, actorUserId, 'share_updated', {
      shares: input.shares
    });

    return { success: true };
  });
}

export async function recordContribution(
  tenantId: string,
  id: string,
  userId: string,
  input: RecordContributionInput
) {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (booking.status !== 'active') {
      throw badRequest('Payments can only be recorded for active group bookings');
    }

    const member = await findGroupBookingMember(tx, booking.id, userId);
    if (!member || member.inviteStatus !== 'accepted') {
      throw forbidden('Only accepted members can contribute to the group booking');
    }

    const contribution = Number(input.amount);
    const newPaidAmount = Number(member.paidAmount) + contribution;
    const contributionLimit = Number(member.contributionAmount);

    if (newPaidAmount > contributionLimit + 0.001) {
      throw badRequest(`Your contribution of ${contribution} exceeds your remaining share allocation of ${(contributionLimit - Number(member.paidAmount)).toFixed(2)}`);
    }

    const updatedMember = await updateGroupBookingMemberRecord(tx, member.id, {
      paidAmount: newPaidAmount.toFixed(2)
    });

    const whereConditions = [eq(groupBookings.id, booking.id), isNull(groupBookings.deletedAt)];
    if (input.lastKnownUpdatedAt) {
      whereConditions.push(optimisticLockCondition(groupBookings.updatedAt, input.lastKnownUpdatedAt));
    }

    const [updatedBooking] = await tx
      .update(groupBookings)
      .set({
        collectedAmount: sql`${groupBookings.collectedAmount} + ${contribution.toFixed(2)}`,
        version: sql`${groupBookings.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(...whereConditions))
      .returning();

    if (input.lastKnownUpdatedAt) {
      assertOptimisticUpdate(updatedBooking);
    }

    await createGroupBookingActivityRecord(tx, booking.id, userId, 'contribution_recorded', {
      amount: contribution.toFixed(2),
      userId
    });

    if (Number(updatedBooking.collectedAmount) >= Number(updatedBooking.totalAmount) - 0.001) {
      await tx
        .update(groupBookings)
        .set({
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(groupBookings.id, booking.id));

      const order = await findBookingOrderById(tx, tenantId, booking.bookingOrderId);
      if (order) {
        await updateBookingOrderByOrderNumber(
          tenantId,
          { role: 'owner' } as any,
          booking.createdByUserId,
          order.orderNumber,
          {
            status: 'confirmed',
            lastKnownUpdatedAt: order.updatedAt.toISOString()
          }
        );
      }

      await createGroupBookingActivityRecord(tx, booking.id, null, 'booking_completed', {});

      const members = await listGroupBookingMembers(tx, booking.id);
      for (const m of members) {
        if (m.inviteStatus === 'accepted') {
          await createInAppNotification({
            tenantId,
            userId: m.userId,
            title: 'Group Booking Completed!',
            message: `The group booking "${booking.title}" has been fully paid and confirmed. Your tickets are issued.`,
            type: 'group_booking_completed',
            entityType: 'group_booking',
            entityId: booking.id,
            metadata: { groupBookingId: booking.id, title: booking.title }
          });
        }
      }
    }

    return updatedMember;
  });
}

export async function cancelGroupBooking(
  tenantId: string,
  id: string,
  actorUserId: string,
  input: GroupBookingCancelInput
) {
  return db.transaction(async (tx) => {
    const rawBooking = await findGroupBookingById(tx, tenantId, id);
    if (!rawBooking) {
      throw notFound('Group booking not found');
    }

    const booking = await checkAndProcessExpiration(tx, tenantId, rawBooking);
    if (['cancelled', 'completed', 'expired'].includes(booking.status)) {
      throw badRequest('Terminal group bookings cannot be cancelled');
    }

    const updatedBooking = await updateGroupBookingRecord(tx, tenantId, id, {
      status: 'cancelled',
      lastKnownUpdatedAt: input.lastKnownUpdatedAt
    });
    assertOptimisticUpdate(updatedBooking);

    const actorMember = await assertMember(tx, booking.id, actorUserId);
    if (actorMember.role !== 'owner') {
      throw forbidden('Only the group booking owner can cancel the booking');
    }

    const order = await findBookingOrderById(tx, tenantId, booking.bookingOrderId);
    if (order && !['cancelled', 'expired'].includes(order.status)) {
      await updateBookingOrderByOrderNumber(
        tenantId,
        { role: 'owner' } as any,
        actorUserId,
        order.orderNumber,
        {
          status: 'cancelled',
          cancellationReason: 'Group booking cancelled by owner',
          lastKnownUpdatedAt: order.updatedAt.toISOString()
        }
      );
    }

    await createGroupBookingActivityRecord(tx, booking.id, actorUserId, 'booking_cancelled', {});

    const members = await listGroupBookingMembers(tx, booking.id);
    for (const m of members) {
      if (m.inviteStatus === 'accepted' && m.userId !== actorUserId) {
        await createInAppNotification({
          tenantId,
          userId: m.userId,
          title: 'Group Booking Cancelled',
          message: `The group booking "${booking.title}" has been cancelled by the owner.`,
          type: 'group_booking_cancelled',
          entityType: 'group_booking',
          entityId: booking.id,
          metadata: { groupBookingId: booking.id, title: booking.title }
        });
      }
    }

    return updatedBooking;
  });
}

export async function getActivityLog(
  tenantId: string,
  id: string,
  userId: string,
  query: GroupBookingActivityQueryInput
) {
  const booking = await findGroupBookingById(db, tenantId, id);
  if (!booking) {
    throw notFound('Group booking not found');
  }

  await assertMember(db, booking.id, userId);

  const pagination = parsePagination(query);
  const { rows, total } = await listGroupBookingActivity(db, booking.id, pagination);

  return {
    items: rows,
    meta: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

export async function assignGroupBookingAttendees(
  tenantId: string,
  id: string,
  actorUserId: string,
  input: { assignments: Array<{ bookingOrderItemId: string; attendeeId?: string; attendee?: any }>; lastKnownUpdatedAt?: string }
) {
  return db.transaction(async (tx) => {
    const booking = await findGroupBookingById(tx, tenantId, id);
    if (!booking) {
      throw notFound('Group booking not found');
    }

    const updatedBooking = await checkAndProcessExpiration(tx, tenantId, booking);
    if (updatedBooking.status !== 'completed' && updatedBooking.status !== 'active') {
      throw badRequest('Attendees can only be assigned to active or completed group bookings');
    }

    if (input.lastKnownUpdatedAt) {
      const lockedBooking = await updateGroupBookingRecord(tx, tenantId, id, {
        lastKnownUpdatedAt: input.lastKnownUpdatedAt
      });
      assertOptimisticUpdate(lockedBooking);
    }

    const member = await findGroupBookingMember(tx, updatedBooking.id, actorUserId);
    if (!member || member.inviteStatus !== 'accepted') {
      throw forbidden('Only accepted group booking members can assign attendees');
    }

    const orderItems = await findBookingOrderItemsForOrder(tx, tenantId, updatedBooking.bookingOrderId);
    const itemsById = new Map(orderItems.map((item) => [item.id, item]));

    for (const assignment of input.assignments) {
      const item = itemsById.get(assignment.bookingOrderItemId);
      if (!item) {
        throw badRequest(`Invalid bookingOrderItemId: ${assignment.bookingOrderItemId}`);
      }
    }

    const existingAssignments = await tx
      .select()
      .from(bookingOrderItemAttendees)
      .where(
        and(
          eq(bookingOrderItemAttendees.bookingOrderId, updatedBooking.bookingOrderId),
          eq(bookingOrderItemAttendees.assignedByUserId, actorUserId),
          isNull(bookingOrderItemAttendees.deletedAt)
        )
      );

    for (const item of orderItems) {
      const ticketUnitPrice = Number(item.unitPrice);
      const limit = Math.ceil(Number(member.contributionAmount) / ticketUnitPrice);

      const newAssignmentsCountForItem = input.assignments.filter((a) => a.bookingOrderItemId === item.id).length;
      const existingCount = existingAssignments.filter((ea: any) => ea.bookingOrderItemId === item.id).length;

      if (existingCount + newAssignmentsCountForItem > limit) {
        throw conflict(
          `You cannot assign more than ${limit} attendees for ticket type ${item.ticketNameSnapshot} based on your share.`
        );
      }
    }

    const assignmentIds = new Set<string>();

    for (const assignment of input.assignments) {
      const item = itemsById.get(assignment.bookingOrderItemId)!;
      let attendeeRecord: any;

      if (assignment.attendeeId) {
        attendeeRecord = await findAttendeeByTenantAndId(tx, tenantId, assignment.attendeeId);
        if (!attendeeRecord) {
          throw notFound('Attendee not found');
        }
      } else if (assignment.attendee) {
        const created = await createAttendeeRecord(tx, {
          tenantId,
          eventId: updatedBooking.eventId,
          ticketTypeId: item.ticketTypeId,
          bookingOrderId: updatedBooking.bookingOrderId,
          fullName: assignment.attendee.fullName,
          email: assignment.attendee.email,
          phone: assignment.attendee.phone,
          gender: assignment.attendee.gender || null,
          status: 'confirmed',
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          normalizedEmail: assignment.attendee.email.trim().toLowerCase(),
          normalizedPhone: assignment.attendee.phone.trim(),
          dateOfBirthValue: assignment.attendee.dateOfBirth ? new Date(assignment.attendee.dateOfBirth) : null,
          checkedInAtValue: null
        });

        if (!created) {
          throw conflict('Unable to create attendee for assignment');
        }
        attendeeRecord = created;
      } else {
        throw badRequest('Either attendeeId or attendee must be provided');
      }

      const previousAssignment = await findActiveAssignmentForAttendee(tx, tenantId, attendeeRecord.id);
      if (previousAssignment) {
        await softDeleteBookingOrderItemAssignmentRecord(tx, tenantId, attendeeRecord.id);
      }

      const activeAssignments = await countActiveAssignmentsForItem(tx, tenantId, item.id);
      if (activeAssignments >= item.quantity) {
        throw conflict('No remaining capacity on this booking item');
      }

      const assignmentRecord = await createBookingOrderItemAssignmentRecord(tx, {
        tenantId,
        bookingOrderId: updatedBooking.bookingOrderId,
        bookingOrderItemId: item.id,
        attendeeId: attendeeRecord.id,
        assignedByUserId: actorUserId
      });

      if (!assignmentRecord) {
        throw conflict('Unable to assign attendee to booking order item');
      }

      assignmentIds.add(assignmentRecord.id);
    }

    const allAssignments = await findBookingOrderAttendeesForOrder(tx, tenantId, updatedBooking.bookingOrderId);
    await reconcileIssuedTicketsAfterAssignment(tx, tenantId, updatedBooking.bookingOrderId);
    return allAssignments.filter((row) => assignmentIds.has(row.id));
  });
}
