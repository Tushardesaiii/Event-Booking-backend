import type { PaginationMeta } from '../types/api.js';

export interface PaginationInput {
  page?: number;
  limit?: number;
}

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(input: PaginationInput = {}): PaginationParams {
  const page = Number.isFinite(input.page) && (input.page ?? 0) > 0 ? Math.floor(input.page ?? DEFAULT_PAGE) : DEFAULT_PAGE;
  const limitValue = Number.isFinite(input.limit) && (input.limit ?? 0) > 0 ? Math.floor(input.limit ?? DEFAULT_LIMIT) : DEFAULT_LIMIT;
  const limit = Math.min(limitValue, MAX_LIMIT);

  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
}

export function buildPaginationMeta({ page, limit, total }: { page: number; limit: number; total: number; }): PaginationMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}
