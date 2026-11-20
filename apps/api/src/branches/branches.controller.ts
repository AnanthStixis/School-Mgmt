import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { BranchDto } from '@sms/shared';
import { PrismaService } from '../prisma/prisma.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  // TODO(auth): scope to the caller's tenant and branch once authentication lands.
  @Get()
  async list(): Promise<BranchDto[]> {
    try {
      const rows = await this.prisma.branch.findMany({ orderBy: { code: 'asc' } });
      return rows.map(({ id, code, name, board, color }) => ({ id, code, name, board, color }));
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
