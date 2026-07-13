import type { InferSelectModel } from 'drizzle-orm';

import type { venues } from '../../db/schema/venues.js';
import type {
	CreateVenueInput,
	VenueListQueryInput,
	VenueSlugParamsInput,
	UpdateVenueInput
} from './validation.js';

export type VenueRecord = InferSelectModel<typeof venues>;
export type VenueListItem = VenueRecord;
export type VenueDetailItem = VenueRecord;

export type VenueListQuery = VenueListQueryInput;
export type VenueSlugParams = VenueSlugParamsInput;
export type CreateVenueDTO = CreateVenueInput;
export type UpdateVenueDTO = UpdateVenueInput;
