import type { InferSelectModel } from 'drizzle-orm';

import type { ticketTypes } from '../../db/schema/ticket-types.js';
import type {
  CreateTicketTypeInput,
  TicketTypeListQueryInput,
  TicketTypeSlugParamsInput,
  UpdateTicketTypeInput
} from './validation.js';

export type TicketTypeRecord = InferSelectModel<typeof ticketTypes>;

export interface TicketTypeListItem extends TicketTypeRecord {
  availableQuantity: number;
  eventTitle: string | null;
}

export interface TicketTypeDetailItem extends TicketTypeRecord {
  availableQuantity: number;
  eventTitle: string | null;
}

export type TicketTypeSlugParams = TicketTypeSlugParamsInput;
export type TicketTypeListQuery = TicketTypeListQueryInput;
export type CreateTicketTypeDTO = CreateTicketTypeInput;
export type UpdateTicketTypeDTO = UpdateTicketTypeInput;
