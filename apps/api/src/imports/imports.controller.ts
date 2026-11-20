import { BadRequestException, Body, Controller, Get, Header, HttpException, Post } from '@nestjs/common';
import {
  GUARDIAN_RELATIONS,
  STAFF_ACCESS,
  STAFF_IMPORT_COLUMNS,
  STUDENT_IMPORT_COLUMNS,
  STUDENT_STATUSES,
  type GuardianInput,
  type ImportResult,
  type ImportRowResult,
  type StaffAccess,
  type StaffInput,
  type StudentInput,
  type StudentStatus,
} from '@sms/shared';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { normalisePhone } from '../auth/sms';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { ScopeService, isSchoolAdmin } from '../common/scope.service';
import { parseDate } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { StaffService } from '../staff/staff.service';
import { StudentsService } from '../students/students.service';
import { readRecords, toCsvLine, type CsvRecord } from './csv';

const MAX_ROWS = 2000;

class ImportDto {
  @IsString() branchId!: string;
  /** The CSV file's text. */
  @IsString() @MaxLength(5_000_000) csv!: string;
  /** true = validate only and report problems; false = import (only if every row is valid). */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

const tryDate = (v: string, label: string, errors: string[]) => {
  try {
    return parseDate(v) ? v : null;
  } catch {
    errors.push(`${label} "${v}" is not a valid date (use YYYY-MM-DD)`);
    return null;
  }
};

export interface StudentRowContext {
  classIdByName: Map<string, string>;
  existingAdmissionNos: Set<string>;
  seenAdmissionNos: Set<string>;
}

/** Validates one student CSV row and maps it to the create input. Pure, so it is unit-tested. */
export function mapStudentRow(r: CsvRecord, branchId: string, ctx: StudentRowContext): { input: StudentInput; errors: string[] } {
  const d = r.data;
  const errors: string[] = [];
  if (!d.name) errors.push('name is required');

  const adm = d.admission_no || null;
  if (adm) {
    const key = adm.toUpperCase();
    if (ctx.existingAdmissionNos.has(key)) errors.push(`admission_no ${adm} already exists`);
    if (ctx.seenAdmissionNos.has(key)) errors.push(`admission_no ${adm} appears more than once in the file`);
    ctx.seenAdmissionNos.add(key);
  }

  const gender = d.gender ? d.gender.toUpperCase()[0] : null;
  if (gender && !['M', 'F', 'O'].includes(gender)) errors.push(`gender "${d.gender}" must be M, F or O`);

  let classId: string | null = null;
  if (d.class) {
    classId = ctx.classIdByName.get(d.class.trim().toLowerCase()) ?? null;
    if (!classId) errors.push(`class "${d.class}" not found in this branch for the current year`);
  }

  const roll = d.roll_no ? Number(d.roll_no) : null;
  if (d.roll_no && (!Number.isInteger(roll) || roll! < 1)) errors.push(`roll_no "${d.roll_no}" must be a whole number`);

  const status = (d.status || 'Active') as StudentStatus;
  const statusMatch = STUDENT_STATUSES.find((s) => s.toLowerCase() === status.toLowerCase());
  if (!statusMatch) errors.push(`status "${d.status}" must be one of ${STUDENT_STATUSES.join(', ')}`);

  const guardians: GuardianInput[] = [];
  for (const [prefix, label] of [['guardian', 'guardian'], ['guardian2', 'guardian2']] as const) {
    const name = d[`${prefix}_name`];
    const phone = d[`${prefix}_phone`];
    if (!name && !phone) {
      if (prefix === 'guardian') errors.push('guardian_name and guardian_phone are required');
      continue;
    }
    if (!name) errors.push(`${label}_name is required when ${label}_phone is given`);
    if (!phone) errors.push(`${label}_phone is required when ${label}_name is given`);
    else if (!normalisePhone(phone)) errors.push(`${label}_phone "${phone}" is not a valid 10-digit mobile number`);
    const rel = d[`${prefix}_relation`] || (prefix === 'guardian' ? 'Father' : 'Mother');
    const relation = GUARDIAN_RELATIONS.find((x) => x.toLowerCase() === rel.toLowerCase());
    if (!relation) errors.push(`${label}_relation "${rel}" must be Father, Mother or Guardian`);
    guardians.push({ name, phone, relation: relation ?? 'Guardian', email: prefix === 'guardian' ? d.guardian_email || null : null, primary: prefix === 'guardian' });
  }
  if (guardians.length === 2 && normalisePhone(guardians[0].phone) && normalisePhone(guardians[0].phone) === normalisePhone(guardians[1].phone)) {
    errors.push('guardian_phone and guardian2_phone are the same number');
  }

  const dob = d.dob ? tryDate(d.dob, 'dob', errors) : null;

  return {
    errors,
    input: {
      branchId,
      admissionNo: adm,
      name: d.name,
      gender,
      dob,
      classId,
      rollNo: roll,
      status: statusMatch ?? 'Active',
      address: d.address || null,
      guardians,
    },
  };
}

/** Validates one staff CSV row. */
export function mapStaffRow(r: CsvRecord, branchId: string, mayGrantManager: boolean, seenPhones: Set<string>): { input: StaffInput; errors: string[] } {
  const d = r.data;
  const errors: string[] = [];
  if (!d.name) errors.push('name is required');
  if (!d.role) errors.push('role is required (e.g. Teacher, Accounts Officer)');
  const access = (d.access || 'none').toLowerCase() as StaffAccess;
  if (!STAFF_ACCESS.includes(access)) errors.push(`access "${d.access}" must be one of ${STAFF_ACCESS.join(', ')}`);
  if (access === 'manager' && !mayGrantManager) errors.push('only the School Admin can import staff with manager access');
  const phone = d.phone ? normalisePhone(d.phone) : null;
  if (d.phone && !phone) errors.push(`phone "${d.phone}" is not a valid 10-digit mobile number`);
  if (access !== 'none' && STAFF_ACCESS.includes(access) && !d.phone) errors.push('phone is required for staff with login access');
  if (phone) {
    if (seenPhones.has(phone)) errors.push(`phone ${d.phone} appears more than once in the file`);
    seenPhones.add(phone);
  }
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) errors.push(`email "${d.email}" is not valid`);
  const joinedOn = d.joined_on ? tryDate(d.joined_on, 'joined_on', errors) : null;
  return {
    errors,
    input: { branchId, name: d.name, role: d.role, subject: d.subject || null, email: d.email || null, phone: d.phone || null, qualification: d.qualification || null, joinedOn, access },
  };
}

@Controller('imports')
@Roles('manager')
export class ImportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly students: StudentsService,
    private readonly staff: StaffService,
    private readonly audit: AuditService,
  ) {}

  @Get('students/template')
  @RequireModule('students')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="students-template.csv"')
  studentTemplate(): string {
    const example = ['', 'Aarav Menon', 'M', '2013-06-14', '8-A', '1', 'Active', 'Suresh Menon', 'Father', '9876543210', 'suresh@example.com', 'Lakshmi Menon', 'Mother', '9876543211', 'Banashankari II Stage, Bangalore'];
    return [toCsvLine([...STUDENT_IMPORT_COLUMNS]), toCsvLine(example)].join('\r\n') + '\r\n';
  }

  @Get('staff/template')
  @RequireModule('staff')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="staff-template.csv"')
  staffTemplate(): string {
    const example = ['Priya Sharma', 'Teacher', 'Mathematics', 'priya@example.com', '9876500001', 'M.Sc, B.Ed', '2018-06-01', 'teacher'];
    return [toCsvLine([...STAFF_IMPORT_COLUMNS]), toCsvLine(example)].join('\r\n') + '\r\n';
  }

  @Post('students')
  @RequireModule('students')
  async importStudents(@CurrentUser() user: AuthUser, @Body() dto: ImportDto): Promise<ImportResult> {
    const b = await this.scope.branch(user, dto.branchId);
    const year = await this.scope.year(user);
    const { records, headerErrors } = readRecords(dto.csv, STUDENT_IMPORT_COLUMNS, ['name', 'guardian_name', 'guardian_phone']);
    this.assertFile(headerErrors, records.length);

    const classes = await this.prisma.schoolClass.findMany({ where: { branchId: b.id, academicYearId: year.id }, select: { id: true, name: true } });
    const existing = await this.prisma.student.findMany({ where: { branchId: b.id }, select: { admissionNo: true } });
    const ctx: StudentRowContext = {
      classIdByName: new Map(classes.map((c) => [c.name.toLowerCase(), c.id])),
      existingAdmissionNos: new Set(existing.map((e) => e.admissionNo.toUpperCase())),
      seenAdmissionNos: new Set(),
    };
    const mapped = records.map((r) => ({ r, ...mapStudentRow(r, b.id, ctx) }));
    const result = this.summarise(mapped, dto.dryRun !== false);
    if (result.dryRun || result.invalid) return result;

    await this.commit(mapped, (row, tx) => this.students.create(user, row.input, tx, { audit: false }));
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'student.import', entity: 'Student', data: { branch: b.code, created: mapped.length } });
    return { ...result, created: mapped.length };
  }

  @Post('staff')
  @RequireModule('staff')
  async importStaff(@CurrentUser() user: AuthUser, @Body() dto: ImportDto): Promise<ImportResult> {
    const b = await this.scope.branch(user, dto.branchId);
    const { records, headerErrors } = readRecords(dto.csv, STAFF_IMPORT_COLUMNS, ['name', 'role']);
    this.assertFile(headerErrors, records.length);

    const seen = new Set<string>();
    const mapped = records.map((r) => ({ r, ...mapStaffRow(r, b.id, isSchoolAdmin(user), seen) }));
    // Numbers that already have a login can't get another one.
    const phones = mapped.filter((m) => m.input.access !== 'none').map((m) => normalisePhone(m.input.phone ?? '')).filter(Boolean) as string[];
    const taken = new Set((await this.prisma.user.findMany({ where: { phone: { in: phones } }, select: { phone: true } })).map((u) => u.phone));
    for (const m of mapped) {
      const p = normalisePhone(m.input.phone ?? '');
      if (m.input.access !== 'none' && p && taken.has(p)) m.errors.push(`phone ${m.input.phone} already has a login`);
    }
    const result = this.summarise(mapped, dto.dryRun !== false);
    if (result.dryRun || result.invalid) return result;

    await this.commit(mapped, (row, tx) => this.staff.create(user, row.input, tx, { audit: false }));
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'staff.import', entity: 'Staff', data: { branch: b.code, created: mapped.length } });
    return { ...result, created: mapped.length };
  }

  private assertFile(headerErrors: string[], rows: number) {
    if (headerErrors.length) throw new BadRequestException(headerErrors);
    if (!rows) throw new BadRequestException('The file has a header but no rows');
    if (rows > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows per file; split it into smaller files`);
  }

  private summarise(mapped: { r: CsvRecord; errors: string[] }[], dryRun: boolean): ImportResult {
    const bad: ImportRowResult[] = mapped.filter((m) => m.errors.length).map((m) => ({ line: m.r.line, data: m.r.data, errors: m.errors }));
    return { dryRun, total: mapped.length, valid: mapped.length - bad.length, invalid: bad.length, rows: bad, created: 0 };
  }

  /** All rows in one transaction: either every row is imported or none is. */
  private async commit<T extends { r: CsvRecord }>(rows: T[], create: (row: T, tx: Prisma.TransactionClient) => Promise<unknown>) {
    await this.prisma.$transaction(
      async (tx) => {
        for (const row of rows) {
          try {
            await create(row, tx);
          } catch (e) {
            const msg = e instanceof HttpException ? (e.getResponse() as { message?: unknown }).message ?? e.message : (e as Error).message;
            throw new BadRequestException(`Line ${row.r.line}: ${Array.isArray(msg) ? msg.join(', ') : String(msg)}. Nothing was imported.`);
          }
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
