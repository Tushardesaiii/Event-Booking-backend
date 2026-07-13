import type { InferSelectModel } from 'drizzle-orm';

import type { issuedTickets } from '../../db/schema/index.js';
import type {
  CheckInIssuedTicketInput,
  IssuedTicketListQueryInput,
  IssuedTicketNumberParamsInput,
  IssuedTicketValidateInput,
  UpdateIssuedTicketInput
} from './validation.js';

export type IssuedTicketRecord = InferSelectModel<typeof issuedTickets>;

export interface IssuedTicketListItem extends IssuedTicketRecord {
  eventTitle: string | null;
  ticketTypeName: string | null;
  attendeeFullName: string | null;
  attendeeEmail: string | null;
  bookingOrderNumber: string | null;
  bookingOrderItemQuantity: number | null;
  purchaserUserId: string | null;
}

export interface IssuedTicketDetailItem extends IssuedTicketListItem {}

export interface IssuedTicketValidationResult {
  valid: boolean;
  status: 'valid' | 'already_checked_in' | 'cancelled' | 'invalidated' | 'refunded' | 'deleted' | 'tenant_mismatch' | 'stale_ticket' | 'invalid_qr' | 'unauthorized_scanner';
  ticket: IssuedTicketDetailItem | null;
  validationSource: 'ticketNumber' | 'qrCodeToken';
  failureReason?: string | null;
}

export type IssuedTicketNumberParams = IssuedTicketNumberParamsInput;
export type IssuedTicketListQuery = IssuedTicketListQueryInput;
export type IssuedTicketValidateDTO = IssuedTicketValidateInput;
export type UpdateIssuedTicketDTO = UpdateIssuedTicketInput;
export type CheckInIssuedTicketDTO = CheckInIssuedTicketInput;
