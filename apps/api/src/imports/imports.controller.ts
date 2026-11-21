import { BadRequestException, Body, Controller, Get, Header, HttpException, Post } from '@nestjs/common';
import {
  ADMISSION_TYPES,
  BALANCE_HEADER_ALIASES,
  BALANCE_IMPORT_COLUMNS,
  GUARDIAN_RELATIONS,
  normaliseClassName,
  parseLooseDate,
  parseRupees,
  STUDENT_HEADER_ALIASES,
  STUDENT_PROFILE_COLUMNS,
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

const STUDENT_COLUMNS = [...STUDENT_IMPORT_COLUMNS, ...STUDENT_PROFILE_COLUMNS];

export interface StudentProfile {
  admissionType?: string;
  rte?: boolean;
}

export interface StudentRowContext {
  classIdByName: Map<string, string>;
  existingAdmissionNos: Set<string>;
  seenAdmissionNos: Set<string>;
}

/** Validates one student CSV row and maps it to the create input. Pure, so it is unit-tested. */
export function mapStudentRow(r: CsvRecord, branchId: string, ctx: StudentRowContext): { input: StudentInput; profile: StudentProfile; errors: string[] } {
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
    // SchoolElement may give "VIII-A" in one column, or class and section separately.
    const wanted = d.section ? `${d.class} ${d.section}` : d.class;
    classId = ctx.classIdByName.get(normaliseClassName(wanted)) ?? null;
    if (!classId) errors.push(`class "${wanted}" not found in this branch for the current year`);
  }

  const roll = d.roll_no ? Number(d.roll_no) : null;
  if (d.roll_no && (!Number.isInteger(roll) || roll! < 1)) errors.push(`roll_no "${d.roll_no}" must be a whole number`);

  // SchoolElement marks students Active / In-active.
  const status = (/^in-?active$/i.test(d.status ?? '') ? 'Left' : d.status || 'Active') as StudentStatus;
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

  let dob: string | null = null;
  if (d.dob) {
    dob = parseLooseDate(d.dob);
    if (!dob) errors.push(`dob "${d.dob}" is not a valid date (use YYYY-MM-DD or DD-MM-YYYY)`);
  }

  const profile: StudentProfile = {};
  if (d.admission_type) {
    const t = d.admission_type.toLowerCase().replace(/[^a-z]/g, '');
    const match = ADMISSION_TYPES.find((a) => a.toLowerCase().replace(/[^a-z]/g, '') === t) ?? (t.startsWith('new') ? 'New Admission' : t.startsWith('re') ? 'Re-admission' : undefined);
    if (!match) errors.push(`admission_type "${d.admission_type}" must be one of ${ADMISSION_TYPES.join(', ')}`);
    else profile.admissionType = match;
  }
  if (d.rte) {
    const v = d.rte.trim().toLowerCase();
    if (['rte', 'yes', 'y', 'true', '1'].includes(v)) profile.rte = true;
    else if (['non-rte', 'nonrte', 'non rte', 'no', 'n', 'false', '0'].includes(v)) profile.rte = false;
    else errors.push(`rte "${d.rte}" must be RTE or NON-RTE`);
  }

  return {
    errors,
    profile,
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
    const { records, headerErrors, ignored } = readRecords(dto.csv, STUDENT_COLUMNS, ['name', 'guardian_name', 'guardian_phone'], { aliases: STUDENT_HEADER_ALIASES, ignoreUnknown: true });
    this.assertFile(headerErrors, records.length);

    const classes = await this.prisma.schoolClass.findMany({ where: { branchId: b.id, academicYearId: year.id }, select: { id: true, name: true } });
    const existing = await this.prisma.student.findMany({ where: { branchId: b.id }, select: { admissionNo: true } });
    const ctx: StudentRowContext = {
      classIdByName: new Map(classes.map((c) => [normaliseClassName(c.name), c.id])),
      existingAdmissionNos: new Set(existing.map((e) => e.admissionNo.toUpperCase())),
      seenAdmissionNos: new Set(),
    };
    const mapped = records.map((r) => ({ r, ...mapStudentRow(r, b.id, ctx) }));
    const result = { ...this.summarise(mapped, dto.dryRun !== false), ignoredColumns: ignored };
    if (result.dryRun || result.invalid) return result;

    await this.commit(mapped, async (row, tx) => {
      const created = await this.students.create(user, row.input, tx, { audit: false });
      if (row.profile.admissionType || row.profile.rte !== undefined) await tx.student.update({ where: { id: created.id }, data: row.profile });
    });
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

  @Get('balances/template')
  @RequireModule('fees')
  @Roles('manager', 'accounts')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="previous-balances-template.csv"')
  balanceTemplate(): string {
    return [toCsvLine([...BALANCE_IMPORT_COLUMNS]), toCsvLine(['BNMPS26-0001', '12500', '2025-26', 'Term 3 unpaid'])].join('\r\n') + '\r\n';
  }

  /**
   * Unpaid balances from earlier years (from SchoolElement's Previous Balance report). Each becomes a
   * "Previous year balance" fee on the student, confirmed and ready to collect, with no late fee.
   */
  @Post('balances')
  @RequireModule('fees')
  @Roles('manager', 'accounts')
  async importBalances(@CurrentUser() user: AuthUser, @Body() dto: ImportDto): Promise<ImportResult> {
    const b = await this.scope.branch(user, dto.branchId);
    const year = await this.scope.year(user);
    this.scope.assertYearOpen(year);
    const { records, headerErrors, ignored } = readRecords(dto.csv, BALANCE_IMPORT_COLUMNS, ['admission_no', 'amount'], { aliases: BALANCE_HEADER_ALIASES, ignoreUnknown: true });
    this.assertFile(headerErrors, records.length);

    const prevLabel = previousYearLabel(year.label);
    const students = await this.prisma.student.findMany({ where: { branchId: b.id }, select: { id: true, admissionNo: true, name: true } });
    const byAdm = new Map(students.map((s) => [s.admissionNo.toUpperCase(), s]));
    const existingType = await this.prisma.feeType.findFirst({ where: { branchId: b.id, academicYearId: year.id, kind: 'PREVIOUS' }, include: { assignments: { select: { studentId: true } } } });
    const already = new Set(existingType?.assignments.map((a) => a.studentId) ?? []);
    const seen = new Set<string>();
    const mapped = records.map((r) => {
      const d = r.data;
      const errors: string[] = [];
      const s = byAdm.get((d.admission_no ?? '').toUpperCase());
      if (!d.admission_no) errors.push('admission_no is required');
      else if (!s) errors.push(`no student with admission_no ${d.admission_no} in ${b.name}`);
      else {
        if (seen.has(s.id)) errors.push(`admission_no ${d.admission_no} appears more than once in the file`);
        if (already.has(s.id)) errors.push(`${s.name} already has a previous-year balance imported`);
        seen.add(s.id);
      }
      const amount = parseRupees(d.amount ?? '');
      if (amount === null || amount <= 0) errors.push(`amount "${d.amount}" must be a whole number of rupees above 0`);
      const fromYear = d.year || prevLabel;
      if (!/^\d{4}-\d{2}$/.test(fromYear)) errors.push(`year "${d.year}" must look like ${prevLabel}`);
      return { r, errors, studentId: s?.id ?? '', amount: amount ?? 0, fromYear, remarks: d.remarks || null };
    });
    const result = { ...this.summarise(mapped, dto.dryRun !== false), ignoredColumns: ignored };
    if (result.dryRun || result.invalid) return result;

    // One "Previous year balance" fee type per branch and year, due on the first installment date (5 April).
    const due = new Date(year.startsOn.getTime() + 4 * 86_400_000);
    const type =
      existingType ??
      (await this.prisma.feeType.create({
        data: { branchId: b.id, academicYearId: year.id, kind: 'PREVIOUS', name: 'Previous year balance', ratesConfirmed: true, installments: { create: [{ seq: 1, label: 'Previous year balance', dueDate: due }] } },
      }));
    await this.commit(mapped, (row, tx) =>
      tx.feeAssignment.create({
        data: {
          studentId: row.studentId,
          feeTypeId: type.id,
          category: `Balance from ${row.fromYear}${row.remarks ? ` · ${row.remarks}` : ''}`.slice(0, 190),
          gross: row.amount,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          createdById: user.id,
          invoices: { create: [{ studentId: row.studentId, seq: 1, label: 'Previous year balance', dueDate: due, gross: row.amount }] },
        },
      }),
    );
    const total = mapped.reduce((n, m) => n + m.amount, 0);
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'fee.balances_import', entity: 'FeeType', entityId: type.id, data: { branch: b.code, students: mapped.length, total } });
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

/** "2026-27" → "2025-26" */
export const previousYearLabel = (label: string) => {
  const y = Number(label.slice(0, 4)) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};
