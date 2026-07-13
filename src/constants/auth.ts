export const AUTH_COOKIE_NAMES = {
  accessToken: 'access_token',
  refreshToken: 'refresh_token'
} as const;

export const AUTH_TOKEN_TYPES = {
  access: 'access',
  refresh: 'refresh'
} as const;

export const AUTH_TOKEN_DEFAULTS = {
  accessExpiresIn: '15m',
  refreshExpiresIn: '30d'
} as const;