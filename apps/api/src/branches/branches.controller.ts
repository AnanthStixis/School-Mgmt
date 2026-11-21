import { Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { Prisma, type Branch } from '@prisma/client';
import type { BranchDetailDto, BranchDto, BranchSettings } from '@sms/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  IsArray,
  IsIn,
} from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { branchWhere, requireTenant } from '../common/scope';
import { isSchoolAdmin, ScopeService } from '../common/scope.service';
import { clean, defined, sentKeys } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class BranchSettingsDto implements BranchSettings {
  @IsOptional() @IsArray() @IsIn(DAYS, { each: true }) workingDays?: string[];
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) startsAt?: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) endsAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(4) termsPerYear?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) attendanceThreshold?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) lateFeePerDay?: number;
}

class BranchUpdateDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(2, 60) board?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsString() @Length(0, 80) city?: string | null;
  @IsOptional() @IsString() @Length(0, 300) address?: string | null;
  @IsOptional() @IsString() @Length(0, 80) phone?: string | null;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) since?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @ValidateNested() @Type(() => BranchSettingsDto) settings?: BranchSettingsDto;
  @IsOptional() @IsObject() modules?: Record<string, boolean>;
}

class BranchCreateDto extends BranchUpdateDto {
  /** Short code used in receipt and admission numbers. Cannot be changed later. */
  @Matches(/^[A-Z0-9]{2,10}$/, { message: 'code must be 2–10 capital letters or digits' }) code!: string;
  @IsString() @Length(2, 120) declare name: string;
  @IsString() @Length(2, 60) declare board: string;
}

@Controller('branches')
export class BranchesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Branches the caller can see: all of their school's for tenant-wide users, otherwise their own. */
  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<BranchDto[]> {
    const rows = await this.prisma.branch.findMany({ where: { ...branchWhere(user), active: true }, orderBy: { since: 'asc' } });
    return rows.map(({ id, code, name, board, color }) => ({ id, code, name, board, color }));
  }

  /** Full details incl. inactive branches, for the Branches & Config screen. */
  @Get('details')
  @Roles('manager')
  async details(@CurrentUser() user: AuthUser): Promise<BranchDetailDto[]> {
    const rows = await this.prisma.branch.findMany({
      where: branchWhere(user),
      orderBy: { since: 'asc' },
      include: { _count: { select: { classes: true, staff: true } } },
    });
    const students = await this.prisma.student.groupBy({
      by: ['branchId'],
      where: { branchId: { in: rows.map((r) => r.id) }, status: { in: ['Active', 'Temporary'] } },
      _count: true,
    });
    return rows.map((b) => this.toDetail(b, b._count, students.find((s) => s.branchId === b.id)?._count ?? 0));
  }

  @Post()
  @Roles('manager')
  async create(@CurrentUser() user: AuthUser, @Body() dto: BranchCreateDto): Promise<BranchDetailDto> {
    const tenantId = this.requireSchoolAdmin(user);
    try {
      const b = await this.prisma.branch.create({ data: { ...this.data(dto), tenantId, code: dto.code, name: dto.name, board: dto.board } });
      await this.audit.record({ tenantId, actorId: user.id, action: 'branch.create', entity: 'Branch', entityId: b.id, data: { code: b.code, name: b.name } });
      return this.toDetail(b, { classes: 0, staff: 0 }, 0);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Branch code ${dto.code} is already used`);
      throw e;
    }
  }

  @Patch(':id')
  @Roles('manager')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BranchUpdateDto): Promise<BranchDetailDto> {
    const tenantId = this.requireSchoolAdmin(user);
    const before = await this.scope.branch(user, id);
    const b = await this.prisma.branch.update({
      where: { id },
      data: this.data(dto, before),
      include: { _count: { select: { classes: true, staff: true } } },
    });
    const changed = sentKeys(dto);
    await this.audit.record({ tenantId, actorId: user.id, action: 'branch.update', entity: 'Branch', entityId: id, data: { code: b.code, changed } });
    const students = await this.prisma.student.count({ where: { branchId: id, status: { in: ['Active', 'Temporary'] } } });
    return this.toDetail(b, b._count, students);
  }

  /** Only the School Admin (tenant-wide manager) configures branches; branch managers can only view. */
  private requireSchoolAdmin(user: AuthUser): string {
    const tenantId = requireTenant(user);
    if (!isSchoolAdmin(user)) throw new ForbiddenException('Only the School Admin can configure branches');
    return tenantId;
  }

  private data(dto: BranchUpdateDto, before?: Branch): Prisma.BranchUncheckedUpdateInput & Prisma.BranchUncheckedCreateInput {
    const out: Record<string, unknown> = {};
    if (dto.name !== undefined) out.name = dto.name.trim();
    if (dto.board !== undefined) out.board = dto.board.trim();
    if (dto.color !== undefined) out.color = dto.color;
    if (dto.city !== undefined) out.city = clean(dto.city);
    if (dto.address !== undefined) out.address = clean(dto.address);
    if (dto.phone !== undefined) out.phone = clean(dto.phone);
    if (dto.email !== undefined) out.email = clean(dto.email)?.toLowerCase() ?? null;
    if (dto.since !== undefined) out.since = dto.since;
    if (dto.active !== undefined) out.active = dto.active;
    if (dto.settings !== undefined) out.settings = { ...((before?.settings as object) ?? {}), ...defined(dto.settings) };
    if (dto.modules !== undefined) out.modules = { ...((before?.modules as object) ?? {}), ...defined(dto.modules) };
    // Branch phone is kept as typed: often several landlines ("080-2671 3243 / 2671 0873").
    return out as Prisma.BranchUncheckedUpdateInput & Prisma.BranchUncheckedCreateInput;
  }

  private toDetail(b: Branch, c: { classes: number; staff: number }, students: number): BranchDetailDto {
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      board: b.board,
      color: b.color,
      city: b.city,
      address: b.address,
      phone: b.phone,
      email: b.email,
      since: b.since,
      active: b.active,
      settings: (b.settings as BranchSettings) ?? {},
      modules: (b.modules as Record<string, boolean>) ?? {},
      counts: { classes: c.classes, staff: c.staff, students },
    };
  }
}
