import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type FeeBand, type FeeRate, type FeeType, type Student } from '@prisma/client';
import {
  lateFee,
  LATE_FEE_PER_DAY,
  type BranchSettings,
  ADMISSION_TYPES,
  PICKUP_MODES,
  rateKey,
  type AssignBoardDto,
  type AssignmentStatus,
  type FeeActionInput,
  type FeeActionResult,
  type FeeAssignmentDto,
  type FeeBandDto,
  type FeeComponent,
  type FeeInstallmentDto,
  type FeeInvoiceDto,
  type FeeKind,
  type FeeOverviewDto,
  type FeeProfile,
  type FeeSetupDto,
  type FeeTypeDto,
  type FeeTypeInput,
  type FeeTypeUpdate,
  type InvoiceStatus,
  type StudentFeesDto,
} from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { addDays, dayDate, dayString, todayIST } from '../common/dates';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type TypeFull = FeeType & { installments: { seq: number; label: string; dueDate: Date }[]; rates: FeeRate[]; academicYear: { label: string }; _count?: { assignments: number } };
const typeInclude = { installments: { orderBy: { seq: 'asc' as const } }, rates: true, academicYear: { select: { label: true } }, _count: { select: { assignments: true } } };
const MAX_AMOUNT = 10_000_000;

/** The branch's late fee per day (₹), falling back to the school-wide default. */
export const lateFeePerDay = (settings: Prisma.JsonValue | null): number => (settings as BranchSettings | null)?.lateFeePerDay ?? LATE_FEE_PER_DAY;

/** Splits an annual amount equally across installments; the last one takes the rounding. */
export function splitEqually(total: number, n: number): number[] {
  const each = Math.round(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - each * (n - 1) : each));
}

export function invoiceStatus(i: { gross: number; concession: number; adjustment: number; paid: number; dueDate: Date }, today = todayIST()): InvoiceStatus {
  const balance = i.gross - i.concession - i.adjustment - i.paid;
  if (balance <= 0) return 'Paid';
  if (i.paid > 0) return 'Partial';
  return dayString(i.dueDate) < today ? 'Overdue' : 'Pending';
}

/**
 * What the fee chart charges a student for a fee type. Returns null with a reason when the
 * chart has no matching rate (e.g. no transport slab on the student, or no band for the grade).
 */
export function quote(kind: FeeKind, s: { grade: number | null; admissionType: string; transportSlab: string | null; pickupMode: string | null }, bands: Pick<FeeBand, 'name' | 'fromGrade' | 'toGrade'>[], rates: Map<string, number>, customAmount?: number): { category: string; amount: number } | { reason: string } {
  if (kind === 'APPLICATION') {
    const a = rates.get('*');
    return a === undefined ? { reason: 'No application fee amount set' } : { category: 'Application fee', amount: a };
  }
  if (kind === 'CUSTOM') {
    if (customAmount === undefined || customAmount <= 0) return { reason: 'Enter the amount for this custom fee' };
    return { category: 'Custom amount', amount: customAmount };
  }
  if (kind === 'TRANSPORT') {
    if (!s.transportSlab || !s.pickupMode) return { reason: 'No transport slab / pickup mode on the student' };
    const a = rates.get(rateKey(s.transportSlab, s.pickupMode));
    return a === undefined ? { reason: `No rate for ${s.transportSlab} · ${s.pickupMode}` } : { category: `${s.transportSlab} · ${s.pickupMode}`, amount: a };
  }
  if (s.grade === null) return { reason: 'Student has no class' };
  const band = bands.find((b) => s.grade! >= b.fromGrade && s.grade! <= b.toGrade);
  if (!band) return { reason: `No class band covers grade ${s.grade}` };
  const a = rates.get(rateKey(band.name, s.admissionType));
  return a === undefined ? { reason: `No rate for ${band.name} · ${s.admissionType}` } : { category: `${band.name} · ${s.admissionType}`, amount: a };
}

@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  // ================= setup =================

  async setup(user: AuthUser, branchId: string, academicYearId?: string): Promise<FeeSetupDto> {
    const b = await this.scope.branch(user, branchId);
    const year = await this.scope.year(user, academicYearId);
    const [bands, types] = await Promise.all([
      this.prisma.feeBand.findMany({ where: { branchId: b.id }, orderBy: { fromGrade: 'asc' } }),
      this.prisma.feeType.findMany({ where: { branchId: b.id, academicYearId: year.id }, include: typeInclude, orderBy: { createdAt: 'asc' } }),
    ]);
    return { branchId: b.id, academicYearId: year.id, bands: bands.map(this.bandDto), feeTypes: types.map((t) => this.typeDto(t)) };
  }

  async saveBands(user: AuthUser, branchId: string, bands: Omit<FeeBandDto, 'id'>[]): Promise<FeeBandDto[]> {
    const b = await this.scope.branch(user, branchId);
    const sorted = [...bands].sort((x, y) => x.fromGrade - y.fromGrade);
    for (const [i, x] of sorted.entries()) {
      if (!x.name.trim()) throw new BadRequestException('Every band needs a name');
      if (x.fromGrade > x.toGrade) throw new BadRequestException(`${x.name}: "from" grade is after "to" grade`);
      if (i > 0 && x.fromGrade <= sorted[i - 1].toGrade) throw new BadRequestException(`${x.name} overlaps ${sorted[i - 1].name}`);
    }
    if (new Set(sorted.map((x) => x.name.trim().toLowerCase())).size !== sorted.length) throw new BadRequestException('Band names must be unique');
    const before = await this.prisma.feeBand.findMany({ where: { branchId: b.id } });
    const removed = before.filter((x) => !sorted.some((y) => y.name.trim() === x.name));
    if (removed.length) {
      // Removing a band would orphan school-fee rates that use it.
      const used = await this.prisma.feeRate.findFirst({ where: { feeType: { branchId: b.id }, key: { startsWith: `${removed[0].name}|` } } });
      if (used) throw new ConflictException(`Band ${removed[0].name} is used in a fee chart; remove its rates first`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.feeBand.deleteMany({ where: { branchId: b.id, name: { in: removed.map((r) => r.name) } } });
      for (const x of sorted) {
        await tx.feeBand.upsert({ where: { branchId_name: { branchId: b.id, name: x.name.trim() } }, update: { fromGrade: x.fromGrade, toGrade: x.toGrade }, create: { branchId: b.id, name: x.name.trim(), fromGrade: x.fromGrade, toGrade: x.toGrade } });
      }
    });
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'fee.bands_update', entity: 'Branch', entityId: b.id, data: { bands: sorted } as unknown as Prisma.InputJsonValue });
    return (await this.prisma.feeBand.findMany({ where: { branchId: b.id }, orderBy: { fromGrade: 'asc' } })).map(this.bandDto);
  }

  async createType(user: AuthUser, input: FeeTypeInput): Promise<FeeTypeDto> {
    const b = await this.scope.branch(user, input.branchId);
    const year = await this.scope.year(user, input.academicYearId);
    this.scope.assertYearOpen(year);
    this.checkInstallments(input.installments, year);
    const components = this.checkComponents(input.components, input.name);
    try {
      const t = await this.prisma.feeType.create({
        data: {
          branchId: b.id,
          academicYearId: year.id,
          kind: input.kind,
          name: input.name.trim(),
          components: components as unknown as Prisma.InputJsonValue,
          installments: { create: input.installments.map((i, k) => ({ seq: k + 1, label: i.label.trim(), dueDate: dayDate(i.dueDate) })) },
        },
        include: typeInclude,
      });
      await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'fee.type_create', entity: 'FeeType', entityId: t.id, data: { name: t.name, kind: t.kind, year: year.label } });
      return this.typeDto(t);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`${input.name} already exists for ${year.label}`);
      throw e;
    }
  }

  async updateType(user: AuthUser, id: string, u: FeeTypeUpdate): Promise<FeeTypeDto> {
    const t = await this.findType(user, id);
    const year = await this.scope.year(user, t.academicYearId);
    this.scope.assertYearOpen(year);
    if (u.installments) {
      // Invoices already carry the old schedule; changing it would make them disagree.
      if (t._count!.assignments) throw new ConflictException(`${t._count!.assignments} students already have ${t.name}; its installments can no longer change`);
      this.checkInstallments(u.installments, year);
    }
    const components = u.components ? this.checkComponents(u.components, u.name ?? t.name) : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (u.installments) {
        await tx.feeInstallmentPlan.deleteMany({ where: { feeTypeId: id } });
        await tx.feeInstallmentPlan.createMany({ data: u.installments.map((i, k) => ({ feeTypeId: id, seq: k + 1, label: i.label.trim(), dueDate: dayDate(i.dueDate) })) });
      }
      return tx.feeType.update({
        where: { id },
        data: { name: u.name?.trim(), components: components as unknown as Prisma.InputJsonValue, ratesConfirmed: u.ratesConfirmed, active: u.active },
        include: typeInclude,
      });
    });
    await this.audit.record({ tenantId: year.tenantId, actorId: user.id, action: 'fee.type_update', entity: 'FeeType', entityId: id, data: { name: updated.name, changed: Object.entries(u).filter(([, v]) => v !== undefined).map(([k]) => k) } });
    return this.typeDto(updated);
  }

  /** Replaces a fee type's whole rate chart. Existing assignments keep the amount they were given. */
  async saveRates(user: AuthUser, id: string, rates: Record<string, number>): Promise<FeeTypeDto> {
    const t = await this.findType(user, id);
    const year = await this.scope.year(user, t.academicYearId);
    this.scope.assertYearOpen(year);
    const bands = new Set((await this.prisma.feeBand.findMany({ where: { branchId: t.branchId } })).map((b) => b.name));
    for (const [key, amount] of Object.entries(rates)) {
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) throw new BadRequestException(`Amount for ${key} must be a whole number of rupees`);
      const [a, b] = key.split('|');
      if (t.kind === 'APPLICATION' && key !== '*') throw new BadRequestException('An application fee has a single amount');
      if (t.kind === 'CUSTOM') throw new BadRequestException('Custom fees take their amount when assigned');
      if (t.kind === 'SCHOOL' && (!bands.has(a) || !ADMISSION_TYPES.includes(b as never))) throw new BadRequestException(`Unknown band or admission type in "${key}"`);
      if (t.kind === 'TRANSPORT' && (!a?.trim() || !PICKUP_MODES.includes(b as never))) throw new BadRequestException(`Unknown slab or pickup mode in "${key}"`);
    }
    const before = Object.fromEntries(t.rates.map((r) => [r.key, r.amount]));
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.feeRate.deleteMany({ where: { feeTypeId: id } });
      await tx.feeRate.createMany({ data: Object.entries(rates).map(([key, amount]) => ({ feeTypeId: id, key, amount })) });
      return tx.feeType.findUniqueOrThrow({ where: { id }, include: typeInclude });
    });
    const changes = Object.keys({ ...before, ...rates }).filter((k) => before[k] !== rates[k]).map((k) => ({ key: k, from: before[k] ?? null, to: rates[k] ?? null }));
    await this.audit.record({ tenantId: year.tenantId, actorId: user.id, action: 'fee.rates_update', entity: 'FeeType', entityId: id, data: { name: t.name, changes } as unknown as Prisma.InputJsonValue });
    return this.typeDto(updated);
  }

  /** Copies a fee type (schedule, components, rates) to another year, shifting due dates by whole years. */
  async copyType(user: AuthUser, id: string, academicYearId: string): Promise<FeeTypeDto> {
    const t = await this.findType(user, id);
    const target = await this.scope.year(user, academicYearId);
    this.scope.assertYearOpen(target);
    if (target.id === t.academicYearId) throw new BadRequestException('Choose a different academic year');
    const from = await this.scope.year(user, t.academicYearId);
    const years = target.startsOn.getUTCFullYear() - from.startsOn.getUTCFullYear();
    const shift = (d: Date) => {
      const x = new Date(d);
      x.setUTCFullYear(x.getUTCFullYear() + years);
      return dayString(x);
    };
    const yy = (l: string) => l.slice(2, 4) + '-' + l.slice(5, 7);
    const name = t.name.includes(yy(from.label)) ? t.name.replace(yy(from.label), yy(target.label)) : `${t.name} (${target.label})`;
    const created = await this.createType(user, {
      branchId: t.branchId,
      academicYearId: target.id,
      kind: t.kind as FeeKind,
      name,
      components: (t.components as FeeComponent[] | null) ?? undefined,
      installments: t.installments.map((i) => ({ seq: i.seq, label: i.label, dueDate: shift(i.dueDate) })),
    });
    if (t.rates.length) return this.saveRates(user, created.id, Object.fromEntries(t.rates.map((r) => [r.key, r.amount])));
    return created;
  }

  // ================= assignment =================

  async board(user: AuthUser, feeTypeId: string, classId: string): Promise<AssignBoardDto> {
    const t = await this.findType(user, feeTypeId);
    const c = await this.prisma.schoolClass.findUnique({ where: { id: classId } });
    if (!c || c.branchId !== t.branchId) throw new BadRequestException('Class must belong to the fee type’s branch');
    if (c.academicYearId !== t.academicYearId) throw new BadRequestException('Class and fee type are for different academic years');
    const bands = await this.prisma.feeBand.findMany({ where: { branchId: t.branchId } });
    const rates = new Map(t.rates.map((r) => [r.key, r.amount]));
    const students = await this.prisma.student.findMany({
      where: { classId, status: { in: ['Active', 'Temporary'] } },
      include: { feeAssignments: { where: { feeTypeId }, include: { invoices: { select: { paid: true } } } } },
      orderBy: [{ rollNo: 'asc' }, { name: 'asc' }],
    });
    const rows = students.map((s) => {
      const a = s.feeAssignments[0];
      const q = quote(t.kind as FeeKind, { ...s, grade: c.grade }, bands, rates);
      return {
        studentId: s.id,
        name: s.name,
        admissionNo: s.admissionNo,
        rollNo: s.rollNo,
        profile: this.profile(s),
        quote: 'amount' in q ? q : null,
        assignment: a ? { id: a.id, category: a.category, gross: a.gross, status: a.status as AssignmentStatus, onlineEnabled: a.onlineEnabled, paid: a.invoices.reduce((n, i) => n + i.paid, 0) } : null,
      };
    });
    const st = (x: AssignmentStatus) => rows.filter((r) => r.assignment?.status === x).length;
    return {
      feeType: this.typeDto(t),
      classId,
      className: c.name,
      rows,
      counts: { students: rows.length, unassigned: rows.filter((r) => !r.assignment).length, assigned: st('ASSIGNED'), confirmed: st('CONFIRMED'), published: st('PUBLISHED'), online: rows.filter((r) => r.assignment?.onlineEnabled).length },
    };
  }

  /** Bulk lifecycle action for selected students. Each student is handled on its own; problems are reported, not fatal. */
  async act(user: AuthUser, input: FeeActionInput): Promise<FeeActionResult> {
    const t = await this.findType(user, input.feeTypeId);
    const year = await this.scope.year(user, t.academicYearId);
    this.scope.assertYearOpen(year);
    if (!input.studentIds.length) throw new BadRequestException('Select at least one student');
    const students = await this.prisma.student.findMany({
      where: { id: { in: input.studentIds }, branchId: t.branchId },
      include: { class: true, feeAssignments: { where: { feeTypeId: t.id }, include: { invoices: true } } },
    });
    const bands = await this.prisma.feeBand.findMany({ where: { branchId: t.branchId } });
    const rates = new Map(t.rates.map((r) => [r.key, r.amount]));
    const skipped: FeeActionResult['skipped'] = [];
    const missing = input.studentIds.filter((id) => !students.some((s) => s.id === id));
    for (const id of missing) skipped.push({ studentId: id, name: '—', reason: 'Not a student of this branch' });
    let done = 0;
    const now = new Date();

    for (const s of students) {
      const a = s.feeAssignments[0];
      const paid = a?.invoices.reduce((n, i) => n + i.paid, 0) ?? 0;
      const skip = (reason: string) => skipped.push({ studentId: s.id, name: s.name, reason });
      switch (input.action) {
        case 'assign': {
          if (a) {
            skip('Already assigned');
            break;
          }
          if (s.class && s.class.academicYearId !== t.academicYearId) {
            skip(`In a ${s.class.name} class of another academic year`);
            break;
          }
          const q = quote(t.kind as FeeKind, { ...s, grade: s.class?.grade ?? null }, bands, rates, input.amount);
          if (!('amount' in q)) {
            skip(q.reason);
            break;
          }
          await this.createAssignment(this.prisma, t, s.id, q, user.id);
          done++;
          break;
        }
        case 'confirm':
          if (!a) skip('Not assigned');
          else if (a.status !== 'ASSIGNED') skip(`Already ${a.status.toLowerCase()}`);
          else {
            await this.prisma.feeAssignment.update({ where: { id: a.id }, data: { status: 'CONFIRMED', confirmedAt: now } });
            done++;
          }
          break;
        case 'publish':
          if (!a) skip('Not assigned');
          else if (a.status === 'ASSIGNED') skip('Confirm the invoice before publishing');
          else if (a.status === 'PUBLISHED') skip('Already published');
          else {
            await this.prisma.feeAssignment.update({ where: { id: a.id }, data: { status: 'PUBLISHED', publishedAt: now } });
            done++;
          }
          break;
        case 'unpublish':
          if (!a || a.status !== 'PUBLISHED') skip('Not published');
          else if (paid > 0) skip('Payments already received');
          else {
            await this.prisma.feeAssignment.update({ where: { id: a.id }, data: { status: 'CONFIRMED', onlineEnabled: false, publishedAt: null } });
            done++;
          }
          break;
        case 'online_on':
          if (!a || a.status !== 'PUBLISHED') skip('Publish the invoice before enabling online payment');
          else if (a.onlineEnabled) skip('Online payment already on');
          else {
            await this.prisma.feeAssignment.update({ where: { id: a.id }, data: { onlineEnabled: true } });
            done++;
          }
          break;
        case 'online_off':
          if (!a?.onlineEnabled) skip('Online payment is off');
          else {
            await this.prisma.feeAssignment.update({ where: { id: a.id }, data: { onlineEnabled: false } });
            done++;
          }
          break;
        case 'reset':
          // "Reset fee structure": remove an assignment that parents haven't seen and nothing was paid on.
          if (!a) skip('Not assigned');
          else if (a.status === 'PUBLISHED') skip('Unpublish it first');
          else if (paid > 0) skip('Payments already received');
          else {
            await this.prisma.feeAssignment.delete({ where: { id: a.id } });
            done++;
          }
          break;
      }
    }
    if (done) {
      await this.audit.record({
        tenantId: year.tenantId,
        actorId: user.id,
        action: `fee.${input.action}`,
        entity: 'FeeType',
        entityId: t.id,
        data: { feeType: t.name, students: done, studentIds: students.filter((s) => !skipped.some((k) => k.studentId === s.id)).map((s) => s.id) },
      });
    }
    return { done, skipped };
  }

  /**
   * Called when admissions enrols a child: assigns this branch's school fee for the class's year,
   * plus the application fee for new admissions. Unconfirmed, so accounts review before publishing.
   */
  async assignOnEnrol(tx: Tx, studentId: string, actorId: string): Promise<{ assigned: string[]; missing: string[] }> {
    const s = await tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { class: true } });
    const out = { assigned: [] as string[], missing: [] as string[] };
    if (!s.class) {
      out.missing.push('No class yet, so no school fee was assigned');
      return out;
    }
    const types = await tx.feeType.findMany({ where: { branchId: s.branchId, academicYearId: s.class.academicYearId, active: true, kind: { in: s.admissionType === 'New Admission' ? ['SCHOOL', 'APPLICATION'] : ['SCHOOL'] } }, include: typeInclude });
    if (!types.some((t) => t.kind === 'SCHOOL')) out.missing.push('No school fee is set up for this branch and year');
    types.sort((x, y) => (x.kind === 'SCHOOL' ? 0 : 1) - (y.kind === 'SCHOOL' ? 0 : 1)); // school fee first
    const bands = await tx.feeBand.findMany({ where: { branchId: s.branchId } });
    for (const t of types) {
      const q = quote(t.kind as FeeKind, { ...s, grade: s.class.grade }, bands, new Map(t.rates.map((r) => [r.key, r.amount])));
      if ('amount' in q) {
        await this.createAssignment(tx, t, s.id, q, actorId);
        out.assigned.push(`${t.name} (₹${q.amount.toLocaleString('en-IN')})`);
      } else out.missing.push(`${t.name}: ${q.reason}`);
    }
    return out;
  }

  // ================= student accounts =================

  async studentFees(user: AuthUser, studentId: string, academicYearId?: string): Promise<StudentFeesDto> {
    const s = await this.prisma.student.findUnique({ where: { id: studentId }, include: { class: true, branch: { select: { settings: true } }, guardians: { select: { userId: true } } } });
    const notFound = new NotFoundException('Student not found');
    if (!s) throw notFound;
    const parentView = user.role === 'parent';
    if (parentView) {
      if (!s.guardians.some((g) => g.userId === user.id)) throw notFound;
    } else {
      await this.scope.branch(user, s.branchId).catch(() => {
        throw notFound;
      });
    }
    const assignments = await this.prisma.feeAssignment.findMany({
      where: { studentId, ...(parentView ? { status: 'PUBLISHED' } : {}), ...(academicYearId ? { feeType: { academicYearId } } : {}) },
      include: { feeType: { include: { academicYear: { select: { label: true } } } }, invoices: { orderBy: { seq: 'asc' } } },
      orderBy: [{ feeType: { academicYear: { startsOn: 'desc' } } }, { createdAt: 'asc' }],
    });
    const perDay = lateFeePerDay(s.branch.settings);
    const dtos = assignments.map((a) => this.assignmentDto(a, perDay));
    const sum = (k: 'gross' | 'paid' | 'balance' | 'overdue') => dtos.reduce((n, a) => n + a.totals[k], 0);
    return {
      studentId,
      name: s.name,
      admissionNo: s.admissionNo,
      className: s.class?.name ?? null,
      profile: this.profile(s),
      assignments: dtos,
      totals: { gross: sum('gross'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue') },
    };
  }

  async updateProfile(user: AuthUser, studentId: string, p: Partial<FeeProfile>): Promise<FeeProfile> {
    const s = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!s) throw new NotFoundException('Student not found');
    const b = await this.scope.branch(user, s.branchId).catch(() => {
      throw new NotFoundException('Student not found');
    });
    const slab = p.transportSlab === undefined ? s.transportSlab : p.transportSlab?.trim() || null;
    const mode = p.pickupMode === undefined ? s.pickupMode : p.pickupMode || null;
    if (!!slab !== !!mode) throw new BadRequestException('Set both the transport slab and the pickup mode, or neither');
    const u = await this.prisma.student.update({ where: { id: studentId }, data: { admissionType: p.admissionType, rte: p.rte, staffKid: p.staffKid, transportSlab: slab, pickupMode: mode } });
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'fee.profile_update', entity: 'Student', entityId: studentId, data: { before: this.profile(s), after: this.profile(u) } as unknown as Prisma.InputJsonValue });
    return this.profile(u);
  }

  async overview(user: AuthUser, branchId?: string, academicYearId?: string): Promise<FeeOverviewDto> {
    const year = await this.scope.year(user, academicYearId);
    const filter = await this.scope.branchFilter(user, branchId);
    const types = await this.prisma.feeType.findMany({ where: { ...filter, academicYearId: year.id }, include: { branch: true }, orderBy: [{ branchId: 'asc' }, { createdAt: 'asc' }] });
    const typeIds = types.map((t) => t.id);
    const [byType, invoices, studentsByBranch] = await Promise.all([
      this.prisma.feeAssignment.groupBy({ by: ['feeTypeId', 'status'], where: { feeTypeId: { in: typeIds } }, _count: true }),
      this.prisma.feeInvoice.findMany({ where: { assignment: { feeTypeId: { in: typeIds } } }, select: { gross: true, concession: true, adjustment: true, paid: true, dueDate: true, assignment: { select: { feeTypeId: true } } } }),
      this.prisma.student.groupBy({ by: ['branchId'], where: { ...filter, status: { in: ['Active', 'Temporary'] }, class: { academicYearId: year.id } }, _count: true }),
    ]);
    const today = todayIST();
    const rows = types.map((t) => {
      const inv = invoices.filter((i) => i.assignment.feeTypeId === t.id);
      const billed = inv.reduce((n, i) => n + i.gross - i.concession - i.adjustment, 0);
      const paid = inv.reduce((n, i) => n + i.paid, 0);
      const overdue = inv.filter((i) => dayString(i.dueDate) < today).reduce((n, i) => n + Math.max(0, i.gross - i.concession - i.adjustment - i.paid), 0);
      const counts = byType.filter((g) => g.feeTypeId === t.id);
      return {
        feeTypeId: t.id,
        feeTypeName: t.name,
        kind: t.kind as FeeKind,
        branchName: t.branch.name,
        students: studentsByBranch.find((g) => g.branchId === t.branchId)?._count ?? 0,
        assigned: counts.reduce((n, g) => n + g._count, 0),
        published: counts.find((g) => g.status === 'PUBLISHED')?._count ?? 0,
        billed,
        paid,
        balance: billed - paid,
        overdue,
      };
    });
    const total = (k: 'billed' | 'paid' | 'balance' | 'overdue') => rows.reduce((n, r) => n + r[k], 0);
    return {
      academicYear: year.label,
      placeholderRates: types.some((t) => t.kind !== 'CUSTOM' && !t.ratesConfirmed),
      rows,
      totals: { billed: total('billed'), paid: total('paid'), balance: total('balance'), overdue: total('overdue'), unpublished: rows.reduce((n, r) => n + r.assigned - r.published, 0) },
    };
  }

  // ================= helpers =================

  private async createAssignment(tx: Tx, t: TypeFull, studentId: string, q: { category: string; amount: number }, actorId: string) {
    if (!t.installments.length) throw new BadRequestException(`${t.name} has no installments`);
    const parts = splitEqually(q.amount, t.installments.length);
    return tx.feeAssignment.create({
      data: {
        studentId,
        feeTypeId: t.id,
        category: q.category,
        gross: q.amount,
        createdById: actorId,
        invoices: { create: t.installments.map((i, k) => ({ studentId, seq: i.seq, label: i.label, dueDate: i.dueDate, gross: parts[k] })) },
      },
    });
  }

  private async findType(user: AuthUser, id: string): Promise<TypeFull> {
    const t = await this.prisma.feeType.findUnique({ where: { id }, include: typeInclude });
    if (!t) throw new NotFoundException('Fee type not found');
    await this.scope.branch(user, t.branchId).catch(() => {
      throw new NotFoundException('Fee type not found');
    });
    return t;
  }

  private checkInstallments(list: FeeInstallmentDto[], year: { startsOn: Date; endsOn: Date; label: string }) {
    if (!list.length || list.length > 12) throw new BadRequestException('A fee needs 1 to 12 installments');
    let prev = '';
    for (const i of list) {
      if (!i.label?.trim()) throw new BadRequestException('Every installment needs a label');
      const d = dayDate(i.dueDate);
      // Allow due dates a little before the year starts (fees are often due before term begins).
      if (d < dayDate(addDays(dayString(year.startsOn), -120)) || d > year.endsOn) throw new BadRequestException(`Due date ${i.dueDate} is outside academic year ${year.label}`);
      if (prev && i.dueDate <= prev) throw new BadRequestException('Installment due dates must be in order');
      prev = i.dueDate;
    }
  }

  private checkComponents(c: FeeComponent[] | undefined, name: string): FeeComponent[] {
    const list = c?.length ? c : [{ name: name.replace(/\s*\d{2}-\d{2}$/, ''), percent: 100 }];
    if (list.some((x) => !x.name.trim() || x.percent <= 0)) throw new BadRequestException('Each component needs a name and a positive %');
    if (list.reduce((n, x) => n + x.percent, 0) !== 100) throw new BadRequestException('Component percentages must add up to 100');
    return list;
  }

  private profile(s: Pick<Student, 'admissionType' | 'rte' | 'staffKid' | 'transportSlab' | 'pickupMode'>): FeeProfile {
    return { admissionType: s.admissionType, rte: s.rte, staffKid: s.staffKid, transportSlab: s.transportSlab, pickupMode: s.pickupMode };
  }

  private bandDto = (b: FeeBand): FeeBandDto => ({ id: b.id, name: b.name, fromGrade: b.fromGrade, toGrade: b.toGrade });

  private typeDto(t: TypeFull): FeeTypeDto {
    const rates = Object.fromEntries(t.rates.map((r) => [r.key, r.amount]));
    return {
      id: t.id,
      branchId: t.branchId,
      academicYearId: t.academicYearId,
      academicYear: t.academicYear.label,
      kind: t.kind as FeeKind,
      name: t.name,
      components: (t.components as FeeComponent[] | null) ?? [],
      ratesConfirmed: t.ratesConfirmed,
      active: t.active,
      installments: t.installments.map((i) => ({ seq: i.seq, label: i.label, dueDate: dayString(i.dueDate) })),
      rates,
      slabs: t.kind === 'TRANSPORT' ? [...new Set(t.rates.map((r) => r.key.split('|')[0]))] : [],
      assignedCount: t._count?.assignments ?? 0,
    };
  }

  private assignmentDto(a: Prisma.FeeAssignmentGetPayload<{ include: { feeType: { include: { academicYear: { select: { label: true } } } }; invoices: true } }>, perDay: number): FeeAssignmentDto {
    const today = todayIST();
    const invoices: FeeInvoiceDto[] = a.invoices.map((i) => {
      const balance = i.gross - i.concession - i.adjustment - i.paid;
      return { id: i.id, seq: i.seq, label: i.label, dueDate: dayString(i.dueDate), gross: i.gross, concession: i.concession, adjustment: i.adjustment, paid: i.paid, balance, status: invoiceStatus(i, today), lateFee: lateFee({ balance, dueDate: dayString(i.dueDate), fineFrom: i.fineFrom ? dayString(i.fineFrom) : null }, today, perDay) };
    });
    const sum = (f: (i: FeeInvoiceDto) => number) => invoices.reduce((n, i) => n + f(i), 0);
    return {
      id: a.id,
      feeTypeId: a.feeTypeId,
      feeTypeName: a.feeType.name,
      kind: a.feeType.kind as FeeKind,
      academicYear: a.feeType.academicYear.label,
      category: a.category,
      gross: a.gross,
      status: a.status as AssignmentStatus,
      onlineEnabled: a.onlineEnabled,
      invoices,
      totals: { gross: sum((i) => i.gross), concession: sum((i) => i.concession), paid: sum((i) => i.paid), balance: sum((i) => Math.max(0, i.balance)), overdue: sum((i) => (i.status === 'Overdue' || (i.status === 'Partial' && i.dueDate < today) ? Math.max(0, i.balance) : 0)) },
    };
  }

  /** Accounts and managers manage fees; parents only read their own children's published fees. */
  static assertStaff(user: AuthUser) {
    if (user.role !== 'accounts' && user.role !== 'manager') throw new ForbiddenException('Only accounts staff and managers can change fees');
  }
}
