import type { Role } from './roles';

/** API contracts shared by the server and its clients. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  db: 'up' | 'down';
  time: string;
}

export interface BranchDto {
  id: string;
  code: string;
  name: string;
  board: string;
  color: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  /** null = all branches of the tenant (group director / platform admin) */
  branchId: string | null;
}
