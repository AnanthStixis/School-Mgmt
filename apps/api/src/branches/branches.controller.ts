import { Controller, Get } from '@nestjs/common';
import type { BranchDto } from '@sms/shared';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/decorators';
import { branchWhere } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Branches the caller can see: all of their school's for tenant-wide users, otherwise their own. */
  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<BranchDto[]> {
    const rows = await this.prisma.branch.findMany({ where: branchWhere(user), orderBy: { since: 'asc' } });
    return rows.map(({ id, code, name, board, color }) => ({ id, code, name, board, color }));
  }
}
