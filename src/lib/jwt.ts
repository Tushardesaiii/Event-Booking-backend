import { createHmac, timingSafeEqual } from 'node:crypto';

export type JwtTokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  type: JwtTokenType;
  iat: number;
  exp: number;
  sid?: string;
  tenantId?: string;
  role?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}

export interface JwtTokenOptions {
  secret: string;
  expiresIn: string | number;
  issuer?: string;
  audience?: string;
}

export interface TokenPairOptions {
  accessSecret: string;
  refreshSecret: string;
  accessExpiresIn: string | number;
  refreshExpiresIn: string | number;
  issuer?: string;
  audience?: string;
}

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecodeToBuffer(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function base64UrlDecodeToString(input: string) {
  return base64UrlDecodeToBuffer(input).toString('utf8');
}

function parseExpiresIn(expiresIn: string | number) {
  if (typeof expiresIn === 'number') {
    return expiresIn;
  }

  const match = /^([0-9]+)([smhd])$/.exec(expiresIn.trim());

  if (!match) {
    throw new Error(`Invalid expiresIn value: ${expiresIn}`);
  }

  const value = Number(match[1]);
  const unit = match[2];

  const unitInSeconds: Record<typeof unit, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24
  };

  return value * unitInSeconds[unit];
}

export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  options: JwtTokenOptions
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresInSeconds = parseExpiresIn(options.expiresIn);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', options.secret).update(content).digest();

  return `${content}.${base64UrlEncode(signature)}`;
}

export function verifyJwt<T extends JwtPayload>(
  token: string,
  secret: string,
  expectedType?: JwtTokenType
) {
  if (typeof token !== 'string' || !token) {
    throw new Error('Invalid token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid token format');
  }

  try {
    const content = `${encodedHeader}.${encodedPayload}`;
    
    let actualSignature: Buffer;
    try {
      actualSignature = base64UrlDecodeToBuffer(encodedSignature);
    } catch {
      throw new Error('Invalid signature format');
    }

    const expectedSignature = createHmac('sha256', secret).update(content).digest();

    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new Error('Invalid token signature');
    }

    let payload: T;
    try {
      payload = JSON.parse(base64UrlDecodeToString(encodedPayload)) as T;
    } catch {
      throw new Error('Invalid token payload json');
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.sub !== 'string' ||
      typeof payload.type !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Invalid token payload');
    }

    if (expectedType && payload.type !== expectedType) {
      throw new Error(`Expected ${expectedType} token`);
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }

    return payload;
  } catch (err: any) {
    throw new Error(err?.message || 'Invalid token');
  }
}

export function createAccessToken(
  payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>,
  options: Omit<JwtTokenOptions, 'expiresIn'> & { expiresIn?: string | number }
) {
  return signJwt(
    {
      ...payload,
      type: 'access'
    },
    {
      secret: options.secret,
      expiresIn: options.expiresIn ?? '15m',
      issuer: options.issuer,
      audience: options.audience
    }
  );
}

export function createRefreshToken(
  payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>,
  options: Omit<JwtTokenOptions, 'expiresIn'> & { expiresIn?: string | number }
) {
  return signJwt(
    {
      ...payload,
      type: 'refresh'
    },
    {
      secret: options.secret,
      expiresIn: options.expiresIn ?? '30d',
      issuer: options.issuer,
      audience: options.audience
    }
  );
}

export function createTokenPair(
  payload: Omit<JwtPayload, 'type' | 'iat' | 'exp'>,
  options: TokenPairOptions
) {
  return {
    accessToken: createAccessToken(payload, {
      secret: options.accessSecret,
      expiresIn: options.accessExpiresIn,
      issuer: options.issuer,
      audience: options.audience
    }),
    refreshToken: createRefreshToken(payload, {
      secret: options.refreshSecret,
      expiresIn: options.refreshExpiresIn,
      issuer: options.issuer,
      audience: options.audience
    })
  };
}
