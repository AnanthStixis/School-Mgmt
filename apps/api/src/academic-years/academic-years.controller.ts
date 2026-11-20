import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { AcademicYear } from '@prisma/client';
import type { AcademicYearDto } from '@sms/shared';
import { IsBoolean, IsDateString, IsOptional, Matches } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { isTenantWide, requireTenant } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

export class CreateAcademicYearDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'label must look like 2027-28' })
  label!: string;

  @IsDateString()
  startsOn!: string;

  @IsDateString()
  endsOn!: string;
}

export class UpdateAcademicYearDto {
  /** true makes this the current year (and clears the flag on every other year). */
  @IsOptional()
  @IsBoolean()
  current?: boolean;

  /** Locked years are read-only archives. */
  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}

const toDto = (y: AcademicYear): AcademicYearDto => ({
  id: y.id,
  label: y.label,
  startsOn: y.startsOn.toISOString().slice(0, 10),
  endsOn: y.endsOn.toISOString().slice(0, 10),
  current: y.current,
  locked: y.locked,
});

@Controller('academic-years')
export class AcademicYearsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<AcademicYearDto[]> {
    const rows = await this.prisma.academicYear.findMany({ where: { tenantId: requireTenant(user) }, orderBy: { startsOn: 'desc' } });
    return rows.map(toDto);
  }

  /** Academic years are trust-wide, so only a tenant-wide manager (e.g. Group Director) may change them. */
  @Post()
  @Roles('manager')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateAcademicYearDto): Promise<AcademicYearDto> {
    const tenantId = this.requireTrustManager(user);
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);
    if (endsOn <= startsOn) throw new BadRequestException('End date must be after start date');

    const exists = await this.prisma.academicYear.findUnique({ where: { tenantId_label: { tenantId, label: dto.label } } });
    if (exists) throw new ConflictException(`Academic year ${dto.label} already exists`);

    const y = await this.prisma.academicYear.create({ data: { tenantId, label: dto.label, startsOn, endsOn } });
    await this.audit.record({ tenantId, actorId: user.id, action: 'academic_year.create', entity: 'AcademicYear', entityId: y.id, data: { label: y.label } });
    return toDto(y);
  }

  @Patch(':id')
  @Roles('manager')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAcademicYearDto): Promise<AcademicYearDto> {
    const tenantId = this.requireTrustManager(user);
    const y = await this.prisma.academicYear.findFirst({ where: { id, tenantId } });
    if (!y) throw new NotFoundException('Academic year not found');
    if (dto.current === false) throw new BadRequestException('Make another year current instead');
    if (dto.current && (dto.locked ?? y.locked)) throw new BadRequestException('A locked year cannot be the current year');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.current) await tx.academicYear.updateMany({ where: { tenantId, current: true }, data: { current: false } });
      return tx.academicYear.update({ where: { id }, data: { current: dto.current ?? undefined, locked: dto.locked ?? undefined } });
    });
    await this.audit.record({
      tenantId,
      actorId: user.id,
      action: 'academic_year.update',
      entity: 'AcademicYear',
      entityId: id,
      data: { label: y.label, before: { current: y.current, locked: y.locked }, after: { current: updated.current, locked: updated.locked } },
    });
    return toDto(updated);
  }

  private requireTrustManager(user: AuthUser): string {
    const tenantId = requireTenant(user);
    if (!isTenantWide(user)) throw new ForbiddenException('Only trust-level managers can change academic years');
    return tenantId;
  }
}
