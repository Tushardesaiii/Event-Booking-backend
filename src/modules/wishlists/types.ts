import type { InferSelectModel } from 'drizzle-orm';
import type { wishlists } from './schema.js';
import type { WishlistEventParamsInput, WishlistListQueryInput } from './validation.js';

export type WishlistRecord = InferSelectModel<typeof wishlists>;

export type WishlistItem = WishlistRecord & {
  event?: {
    id: string;
    title: string;
    slug: string;
    startDateTime: string;
    bannerAssetId: string | null;
  } | null;
};

export type WishlistEventParams = WishlistEventParamsInput;
export type WishlistListQuery = WishlistListQueryInput;
