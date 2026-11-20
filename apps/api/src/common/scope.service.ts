import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import type { AcademicYear, Branch } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { isTenantWide, requireTenant } from './scope';

/** "School Admin" = a manager who is not tied to one branch (e.g. the Group Director). */
export const isSchoolAdmin = (u: AuthUser) => u.role === 'manager' && isTenantWide(u);

/** Looks up records inside the caller's scope, so controllers never trust an id from the client blindly. */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A branch the caller may work in. Branch-bound users only get their own branch;
   * tenant-wide users get any branch of their school. Anything else is reported as not found.
   */
  async branch(user: AuthUser, branchId: string): Promise<Branch> {
    const tenantId = requireTenant(user);
    if (user.branchId && user.branchId !== branchId) throw new NotFoundException('Branch not found');
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!b) throw new NotFoundException('Branch not found');
    return b;
  }

  /** Branch filter for list endpoints: the requested branch (checked) or every branch in scope. */
  async branchFilter(user: AuthUser, branchId?: string): Promise<{ branchId?: string; branch: { tenantId: string } }> {
    const tenantId = requireTenant(user);
    if (branchId) {
      await this.branch(user, branchId);
      return { branchId, branch: { tenantId } };
    }
    return { branch: { tenantId }, ...(user.branchId ? { branchId: user.branchId } : {}) };
  }

  /** The tenant's current academic year (or a specific one, checked to belong to the tenant). */
  async year(user: AuthUser, academicYearId?: string): Promise<AcademicYear> {
    const tenantId = requireTenant(user);
    const y = await this.prisma.academicYear.findFirst({
      where: academicYearId ? { id: academicYearId, tenantId } : { tenantId, current: true },
    });
    if (!y) throw new NotFoundException(academicYearId ? 'Academic year not found' : 'No current academic year is set');
    return y;
  }

  /** Writes into a locked (archived) academic year are refused. */
  assertYearOpen(y: AcademicYear): void {
    if (y.locked) throw new ForbiddenException(`Academic year ${y.label} is locked (read-only)`);
  }
}

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}
