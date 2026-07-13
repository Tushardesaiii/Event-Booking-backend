import type { PublicAuthUser, SessionRecord, TenantMembershipRecord, TenantRecord, TenantMemberRole } from './auth.js';

export interface AppContextVariables {
  user: PublicAuthUser | null;
  authToken: string | null;
  session: SessionRecord | null;
  tenant: TenantRecord | null;
  tenantMembership: TenantMembershipRecord | null;
  requestId: string | null;
  correlationId: string | null;
  validatedBody: unknown;
  validatedQuery: unknown;
  validatedParams: unknown;
}

export type AppEnv = {
  Variables: AppContextVariables;
};

export type AppLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  request: (context: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    requestId?: string;
    tenantId?: string;
  }) => void;
};

export type { TenantMemberRole };
