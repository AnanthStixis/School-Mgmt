import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user';

/**
 * Data-scoping helpers. Every query on tenant data must go through one of these,
 * so a user can never read another school's (or another branch's) records.
 */

/** The caller's tenant. Platform admins have none and are refused tenant data. */
export function requireTenant(u: AuthUser): string {
  if (!u.tenantId) throw new ForbiddenException('This needs a school account');
  return u.tenantId;
}

/** Where-clause for the Branch table: own tenant, and own branch for branch-bound users. */
export function branchWhere(u: AuthUser): Prisma.BranchWhereInput {
  if (u.role === 'admin') return {};
  return { tenantId: requireTenant(u), ...(u.branchId ? { id: u.branchId } : {}) };
}

/** Where-clause fragment for tables that have a branchId column (Student, Staff, SchoolClass…). */
export function branchScoped(u: AuthUser): { branchId?: string; branch: { tenantId: string } } {
  const tenantId = requireTenant(u);
  return { branch: { tenantId }, ...(u.branchId ? { branchId: u.branchId } : {}) };
}

/** True when the caller works across all branches of the tenant (e.g. Group Director). */
export const isTenantWide = (u: AuthUser) => !!u.tenantId && u.branchId === null;
