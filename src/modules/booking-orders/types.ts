import type { InferSelectModel } from 'drizzle-orm';

import type { bookingOrderItemAttendees, bookingOrderItems, bookingOrders } from '../../db/schema/index.js';
import type {
  AssignBookingOrderAttendeesInput,
  BookingOrderAttendeesQueryInput,
  BookingOrderListQueryInput,
  BookingOrderNumberParamsInput,
  CreateBookingOrderInput,
  UpdateBookingOrderInput
} from './validation.js';

export type BookingOrderRecord = InferSelectModel<typeof bookingOrders>;
export type BookingOrderItemRecord = InferSelectModel<typeof bookingOrderItems>;
export type BookingOrderAttendeeRecord = InferSelectModel<typeof bookingOrderItemAttendees>;

export interface BookingOrderListItem extends BookingOrderRecord {
  eventTitle: string | null;
  purchaserFullName: string | null;
  purchaserUsername: string | null;
}

export interface BookingOrderDetailItem extends BookingOrderListItem {}

export interface BookingOrderItemListItem extends BookingOrderItemRecord {}

export interface BookingOrderAttendeeListItem extends BookingOrderAttendeeRecord {
  attendeeFullName: string;
  attendeeEmail: string;
  attendeePhone: string;
  attendeeStatus: string;
  ticketTypeNameSnapshot: string;
  ticketTypeSlugSnapshot: string;
}

export type BookingOrderNumberParams = BookingOrderNumberParamsInput;
export type BookingOrderListQuery = BookingOrderListQueryInput;
export type CreateBookingOrderDTO = CreateBookingOrderInput;
export type UpdateBookingOrderDTO = UpdateBookingOrderInput;
export type AssignBookingOrderAttendeesDTO = AssignBookingOrderAttendeesInput;
export type BookingOrderAttendeesQuery = BookingOrderAttendeesQueryInput;