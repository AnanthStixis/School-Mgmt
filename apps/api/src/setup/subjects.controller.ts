import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, type Subject } from '@prisma/client';
import { SUBJECT_TYPES, type SubjectDto, type SubjectType } from '@sms/shared';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule } from '../auth/decorators';
import { ScopeService } from '../common/scope.service';
import { sentKeys } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

class SubjectUpdateDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @IsIn(SUBJECT_TYPES) type?: SubjectType;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() onReport?: boolean;
}

class SubjectCreateDto extends SubjectUpdateDto {
  @IsString() branchId!: string;
  @IsString() @Length(2, 60) declare name: string;
  @Matches(/^[A-Z0-9-]{2,10}$/, { message: 'code must be 2–10 capital letters, digits or -' }) code!: string;
}

const toDto = (s: Subject): SubjectDto => ({
  id: s.id,
  branchId: s.branchId,
  name: s.name,
  code: s.code,
  type: s.type as SubjectType,
  active: s.active,
  onReport: s.onReport,
});

@Controller('subjects')
export class SubjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string): Promise<SubjectDto[]> {
    const where = await this.scope.branchFilter(user, branchId);
    const rows = await this.prisma.subject.findMany({ where, orderBy: [{ branchId: 'asc' }, { type: 'asc' }, { name: 'asc' }] });
    return rows.map(toDto);
  }

  @Post()
  @RequireModule('setup')
  async create(@CurrentUser() user: AuthUser, @Body() dto: SubjectCreateDto): Promise<SubjectDto> {
    const b = await this.scope.branch(user, dto.branchId);
    try {
      const s = await this.prisma.subject.create({
        data: { branchId: b.id, name: dto.name.trim(), code: dto.code, type: dto.type ?? 'Core', active: dto.active ?? true, onReport: dto.onReport ?? true },
      });
      await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'subject.create', entity: 'Subject', entityId: s.id, data: { code: s.code, branch: b.code } });
      return toDto(s);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Subject code ${dto.code} already exists in ${b.name}`);
      throw e;
    }
  }

  @Patch(':id')
  @RequireModule('setup')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubjectUpdateDto): Promise<SubjectDto> {
    const s = await this.prisma.subject.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Subject not found');
    const b = await this.scope.branch(user, s.branchId).catch(() => {
      throw new NotFoundException('Subject not found');
    });
    const u = await this.prisma.subject.update({ where: { id }, data: { name: dto.name?.trim(), type: dto.type, active: dto.active, onReport: dto.onReport } });
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'subject.update', entity: 'Subject', entityId: id, data: { code: u.code, changed: sentKeys(dto) } });
    return toDto(u);
  }
}
