export const ERROR_CODES = {
  badRequest: 'BAD_REQUEST',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  validation: 'VALIDATION_ERROR',
  database: 'DATABASE_ERROR',
  invalidToken: 'INVALID_TOKEN',
  tokenExpired: 'TOKEN_EXPIRED',
  internal: 'INTERNAL_SERVER_ERROR'
} as const;