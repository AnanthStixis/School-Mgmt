import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import type { Branch, Prisma } from '@prisma/client';
import { gradeLabel, type ClassDto } from '@sms/shared';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule } from '../auth/decorators';
import { ScopeService } from '../common/scope.service';
import { clean, sentKeys } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

class ClassBulkDto {
  @IsString() branchId!: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsInt() @Min(-2) @Max(12) fromGrade!: number;
  @IsInt() @Min(-2) @Max(12) toGrade!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @Matches(/^[A-Za-z0-9]{1,12}$/, { each: true, message: 'each section must be 1–12 letters or digits' }) sections!: string[];
}

class ClassUpdateDto {
  @IsOptional() @IsString() @Length(1, 40) name?: string;
  @IsOptional() @Matches(/^[A-Za-z0-9]{1,12}$/) section?: string;
  @IsOptional() @IsString() @Length(0, 20) room?: string | null;
  @IsOptional() @IsString() classTeacherId?: string | null;
}

type ClassRow = Prisma.SchoolClassGetPayload<{ include: { classTeacher: true; _count: { select: { students: true } } } }>;

const toDto = (c: ClassRow): ClassDto => ({
  id: c.id,
  branchId: c.branchId,
  academicYearId: c.academicYearId,
  grade: c.grade,
  section: c.section,
  name: c.name,
  room: c.room,
  classTeacher: c.classTeacher ? { id: c.classTeacher.id, name: c.classTeacher.name } : null,
  studentCount: c._count.students,
});

const include = { classTeacher: true, _count: { select: { students: true } } } as const;

/**
 * Default class name. PU College branches use "PUC I/II <stream>"; others "8-A", "LKG-B".
 * Staff can rename afterwards.
 */
export function className(branch: Pick<Branch, 'board'>, grade: number, section: string): string {
  if (/puc/i.test(branch.board) && (grade === 11 || grade === 12)) return `PUC ${grade === 11 ? 'I' : 'II'} ${section}`;
  return `${gradeLabel(grade)}-${section}`;
}

@Controller('classes')
export class ClassesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Classes for one academic year (current by default), across the caller's branches or one branch. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('academicYearId') academicYearId?: string): Promise<ClassDto[]> {
    const where = await this.scope.branchFilter(user, branchId);
    const year = await this.scope.year(user, academicYearId);
    const rows = await this.prisma.schoolClass.findMany({
      where: { ...where, academicYearId: year.id },
      include,
      orderBy: [{ branchId: 'asc' }, { grade: 'asc' }, { section: 'asc' }],
    });
    return rows.map(toDto);
  }

  /** Adds grades from–to × sections in one go (POC: "Add classes by standard range"). Existing ones are skipped. */
  @Post('bulk')
  @RequireModule('setup')
  async bulk(@CurrentUser() user: AuthUser, @Body() dto: ClassBulkDto): Promise<{ created: ClassDto[]; skipped: string[] }> {
    if (dto.toGrade < dto.fromGrade) throw new BadRequestException('"To" grade must be the same as or after "From" grade');
    const b = await this.scope.branch(user, dto.branchId);
    const year = await this.scope.year(user, dto.academicYearId);
    this.scope.assertYearOpen(year);

    const sections = [...new Set(dto.sections.map((s) => s.trim().toUpperCase()))];
    const wanted: { grade: number; section: string; name: string }[] = [];
    for (let g = dto.fromGrade; g <= dto.toGrade; g++) for (const s of sections) wanted.push({ grade: g, section: s, name: className(b, g, s) });

    const existing = await this.prisma.schoolClass.findMany({ where: { branchId: b.id, academicYearId: year.id, name: { in: wanted.map((w) => w.name) } }, select: { name: true } });
    const skip = new Set(existing.map((e) => e.name));
    const toCreate = wanted.filter((w) => !skip.has(w.name));

    const created = await this.prisma.$transaction(
      toCreate.map((w) => this.prisma.schoolClass.create({ data: { branchId: b.id, academicYearId: year.id, ...w }, include })),
    );
    if (created.length) {
      await this.audit.record({
        tenantId: b.tenantId,
        actorId: user.id,
        action: 'class.bulk_create',
        entity: 'SchoolClass',
        data: { branch: b.code, year: year.label, classes: created.map((c) => c.name) },
      });
    }
    return { created: created.map(toDto), skipped: [...skip] };
  }

  @Patch(':id')
  @RequireModule('setup')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ClassUpdateDto): Promise<ClassDto> {
    const c = await this.find(user, id);
    const year = await this.scope.year(user, c.academicYearId);
    this.scope.assertYearOpen(year);

    if (dto.classTeacherId) {
      const t = await this.prisma.staff.findFirst({ where: { id: dto.classTeacherId, branchId: c.branchId, status: 'Active' } });
      if (!t) throw new BadRequestException('Class teacher must be active staff of the same branch');
    }
    const name = dto.name?.trim();
    if (name && name !== c.name) {
      const clash = await this.prisma.schoolClass.findFirst({ where: { branchId: c.branchId, academicYearId: c.academicYearId, name, NOT: { id } } });
      if (clash) throw new ConflictException(`A class named ${name} already exists`);
    }
    const u = await this.prisma.schoolClass.update({
      where: { id },
      data: {
        name,
        section: dto.section?.toUpperCase(),
        room: dto.room === undefined ? undefined : clean(dto.room),
        classTeacherId: dto.classTeacherId === undefined ? undefined : dto.classTeacherId || null,
      },
      include,
    });
    await this.audit.record({ tenantId: year.tenantId, actorId: user.id, action: 'class.update', entity: 'SchoolClass', entityId: id, data: { name: u.name, changed: sentKeys(dto) } });
    return toDto(u);
  }

  /** Only empty classes can be deleted (POC rule). */
  @Delete(':id')
  @HttpCode(204)
  @RequireModule('setup')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    const c = await this.find(user, id);
    const year = await this.scope.year(user, c.academicYearId);
    this.scope.assertYearOpen(year);
    if (c._count.students > 0) throw new ConflictException(`${c.name} has ${c._count.students} students. Move them to another class first.`);
    // Attendance history must survive, so a class that has registers is kept.
    if (await this.prisma.attendanceRegister.count({ where: { classId: id } })) throw new ConflictException(`${c.name} has attendance history and cannot be deleted`);
    await this.prisma.schoolClass.delete({ where: { id } });
    await this.audit.record({ tenantId: year.tenantId, actorId: user.id, action: 'class.delete', entity: 'SchoolClass', entityId: id, data: { name: c.name } });
  }

  private async find(user: AuthUser, id: string): Promise<ClassRow> {
    const c = await this.prisma.schoolClass.findUnique({ where: { id }, include });
    if (!c) throw new NotFoundException('Class not found');
    await this.scope.branch(user, c.branchId).catch(() => {
      throw new NotFoundException('Class not found');
    });
    return c;
  }
}
