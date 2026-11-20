import type { Role } from '@sms/shared';

/** The signed-in caller, decoded from the access token and attached to the request. */
export interface AuthUser {
  id: string;
  role: Role;
  /** null only for the Stixis platform admin */
  tenantId: string | null;
  /** null = every branch of the tenant */
  branchId: string | null;
}

/** Claims carried in the access token. Short names keep the token small. */
export interface AccessClaims {
  sub: string;
  role: Role;
  tid: string | null;
  bid: string | null;
}
