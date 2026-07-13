import type { InferSelectModel } from 'drizzle-orm';

import type { attendees } from '../../db/schema/attendees.js';
import type {
  AttendeeIdParamsInput,
  AttendeeListQueryInput,
  CreateAttendeeInput,
  UpdateAttendeeInput
} from './validation.js';

export type AttendeeRecord = InferSelectModel<typeof attendees>;

export interface AttendeeListItem extends AttendeeRecord {
  eventTitle?: string | null;
  ticketTypeName?: string | null;
}

export interface AttendeeDetailItem extends AttendeeRecord {
  eventTitle?: string | null;
  ticketTypeName?: string | null;
}

export type AttendeeIdParams = AttendeeIdParamsInput;
export type AttendeeListQuery = AttendeeListQueryInput;
export type CreateAttendeeDTO = CreateAttendeeInput;
export type UpdateAttendeeDTO = UpdateAttendeeInput;