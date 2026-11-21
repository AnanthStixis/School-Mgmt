import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  allocate,
  chargesLateFee,
  INSTRUMENT_MODES,
  lateFee,
  type AdjustmentInput,
  type ClassSummaryDto,
  type ClassSummaryRow,
  type ConcessionInput,
  type CorrectionDto,
  type CorrectionKind,
  type CorrectionsReportDto,
  type DuesReportDto,
  type DuesRow,
  type FineWaiverInput,
  type ReceiptDto,
  type RefundInput,
  type ReminderInput,
  type ReminderResult,
} from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { addDays, dayDate, dayString, todayIST } from '../common/dates';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { clean } from '../common/validation';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionService, receiptDto, receiptInclude, refundableOf, refundDto } from './collection.service';
import { FeesService, lateFeePerDay } from './fees.service';

const IST_MS = 5.5 * 3_600_000;
const COLLECTABLE = ['CONFIRMED', 'PUBLISHED'];

const correctionInclude = {
  student: { select: { name: true, admissionNo: true, class: { select: { name: true } }, branch: { select: { name: true } } } },
  assignment: { select: { feeType: { select: { name: true } } } },
} satisfies Prisma.FeeCorrectionInclude;
type CorrectionFull = Prisma.FeeCorrectionGetPayload<{ include: typeof correctionInclude }>;

const assignmentInclude = {
  feeType: { select: { name: true, kind: true } },
  invoices: { orderBy: { seq: 'asc' } },
  student: { include: { branch: { select: { tenantId: true, settings: true } } } },
} satisfies Prisma.FeeAssignmentInclude;
type AssignmentFull = Prisma.FeeAssignmentGetPayload<{ include: typeof assignmentInclude }>;

const balanceOf = (i: { gross: number; concession: number; adjustment: number; paid: number }) => i.gross - i.concession - i.adjustment - i.paid;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * Corrections to a student's fees. Every one needs a reason and is recorded with who and when
 * (FeeCorrection / FeeRefund) as well as in the audit log, as the school's reports show today.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly collection: CollectionService,
    private readonly notifications: NotificationsService,
  ) {}

  // ================= concession =================

  /** Sets the concession on an assignment (replacing any earlier one), spread over its unpaid installments. */
  async concession(user: AuthUser, input: ConcessionInput): Promise<CorrectionDto> {
    const a = await this.findAssignment(user, input.assignmentId);
    const remarks = this.reason(input.remarks);
    if (!Number.isFinite(input.value) || input.value < 0) throw new BadRequestException('Enter a concession of 0 or more');
    if (input.basis === 'percent' && input.value > 100) throw new BadRequestException('A percentage concession must be 100 or less');
    // Room on each installment once the old concession is taken off: whatever is not paid or written off.
    const room = a.invoices.map((i) => Math.max(0, i.gross - i.adjustment - i.paid));
    const totalRoom = room.reduce((x, y) => x + y, 0);

    let parts: number[];
    if (input.method === 'Manual') {
      parts = a.invoices.map((i, k) => {
        const v = Math.round(Number(input.manual?.[i.id] ?? 0));
        if (!Number.isFinite(v) || v < 0) throw new BadRequestException(`Enter 0 or more for ${i.label}`);
        if (v > room[k]) throw new BadRequestException(`${rupees(v)} is more than the ${rupees(room[k])} still unpaid on ${i.label}`);
        return v;
      });
    } else {
      const total = input.basis === 'percent' ? Math.round((a.gross * input.value) / 100) : Math.round(input.value);
      const p = allocate(total, room, input.method);
      if (!p) throw new BadRequestException(`${rupees(total)} is more than the ${rupees(totalRoom)} still unpaid on ${a.feeType.name}`);
      parts = p;
    }
    const total = parts.reduce((x, y) => x + y, 0);
    const previous = a.invoices.reduce((n, i) => n + i.concession, 0);

    const row = await this.prisma.$transaction(async (tx) => {
      for (const [k, i] of a.invoices.entries()) {
        if (parts[k] === i.concession) continue;
        const { count } = await tx.feeInvoice.updateMany({ where: { id: i.id, paid: i.paid, concession: i.concession, adjustment: i.adjustment }, data: { concession: parts[k] } });
        if (count !== 1) throw new ConflictException(`${i.label} changed while you were editing. Reload and try again.`);
      }
      return this.record(tx, user, a, 'CONCESSION', total, {
        lines: a.invoices.map((i, k) => ({ invoiceId: i.id, label: i.label, amount: parts[k] })),
        method: input.method,
        basis: input.basis,
        value: input.value,
        previous,
      }, total ? remarks : `Concession removed: ${remarks}`);
    });
    await this.audit.record({ tenantId: a.student.branch.tenantId, actorId: user.id, action: 'fee.concession', entity: 'FeeAssignment', entityId: a.id, data: { studentId: a.studentId, previous, total, method: input.method, remarks } });
    return toDto(row);
  }

  // ================= adjustment (write-off) =================

  /** Writes off part of the unpaid fee (a student leaving, or an exceptional waiver), from the last installment back. */
  async adjustment(user: AuthUser, input: AdjustmentInput): Promise<CorrectionDto> {
    const a = await this.findAssignment(user, input.assignmentId);
    const reason = this.reason(input.remarks);
    const amount = Math.round(input.amount);
    if (!(amount > 0)) throw new BadRequestException('Enter the amount to write off');
    const rev = [...a.invoices].reverse();
    const parts = allocate(amount, rev.map((i) => Math.max(0, balanceOf(i))), 'Order Wise');
    const unpaid = a.invoices.reduce((n, i) => n + Math.max(0, balanceOf(i)), 0);
    if (!parts) throw new BadRequestException(`${rupees(amount)} is more than the ${rupees(unpaid)} unpaid on ${a.feeType.name}`);

    const row = await this.prisma.$transaction(async (tx) => {
      for (const [k, i] of rev.entries()) {
        if (!parts[k]) continue;
        const { count } = await tx.feeInvoice.updateMany({ where: { id: i.id, paid: i.paid, concession: i.concession, adjustment: i.adjustment }, data: { adjustment: { increment: parts[k] } } });
        if (count !== 1) throw new ConflictException(`${i.label} changed while you were editing. Reload and try again.`);
      }
      return this.record(
        tx,
        user,
        a,
        'ADJUSTMENT',
        amount,
        { lines: rev.map((i, k) => ({ invoiceId: i.id, label: i.label, amount: parts[k] })).filter((l) => l.amount).reverse() },
        // The existing system's wording, so reports read the same.
        `The total adjustment amount ${rupees(amount)} out of a total amount of ${rupees(a.gross)} (${reason})`,
      );
    });
    await this.audit.record({ tenantId: a.student.branch.tenantId, actorId: user.id, action: 'fee.adjustment', entity: 'FeeAssignment', entityId: a.id, data: { studentId: a.studentId, amount, reason } });
    return toDto(row);
  }

  // ================= late fee waiver =================

  /** Waives the late fee owed today on one installment, without taking a payment. It starts again from today. */
  async waiveFine(user: AuthUser, input: FineWaiverInput): Promise<CorrectionDto> {
    const inv = await this.prisma.feeInvoice.findUnique({ where: { id: input.invoiceId }, select: { assignmentId: true } });
    if (!inv) throw new NotFoundException('Installment not found');
    const a = await this.findAssignment(user, inv.assignmentId);
    const reason = this.reason(input.remarks);
    const i = a.invoices.find((x) => x.id === input.invoiceId)!;
    const today = todayIST();
    const due = lateFee({ balance: balanceOf(i), dueDate: dayString(i.dueDate), fineFrom: i.fineFrom ? dayString(i.fineFrom) : null }, today, chargesLateFee(a.feeType.kind) ? lateFeePerDay(a.student.branch.settings) : 0);
    if (!due) throw new BadRequestException(`There is no late fee on ${i.label} today`);

    const row = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.feeInvoice.updateMany({ where: { id: i.id, paid: i.paid, fineWaived: i.fineWaived, finePaid: i.finePaid }, data: { fineWaived: { increment: due }, fineFrom: dayDate(today) } });
      if (count !== 1) throw new ConflictException(`${i.label} changed while you were editing. Reload and try again.`);
      return this.record(tx, user, a, 'FINE_WAIVER', due, { lines: [{ invoiceId: i.id, label: i.label, amount: due }] }, reason);
    });
    await this.audit.record({ tenantId: a.student.branch.tenantId, actorId: user.id, action: 'fee.fine_waive', entity: 'FeeInvoice', entityId: i.id, data: { studentId: a.studentId, amount: due, reason } });
    return toDto(row);
  }

  // ================= refund =================

  /** Pays money back against a receipt. The balance is unchanged; the money collected goes down. */
  async refund(user: AuthUser, input: RefundInput): Promise<ReceiptDto> {
    FeesService.assertStaff(user);
    const r = await this.collection.findReceipt(user, input.receiptId);
    const remarks = this.reason(input.remarks);
    const amount = Math.round(input.amount);
    const refundable = refundableOf(r);
    if (r.status !== 'SUCCESS') throw new BadRequestException(`Receipt ${r.no} is cancelled`);
    if (r.recon === 'PENDING') throw new BadRequestException(`Receipt ${r.no} is still waiting for the bank; reconcile it first`);
    if (!(amount > 0)) throw new BadRequestException('Enter the amount to refund');
    if (amount > refundable) throw new BadRequestException(`Only ${rupees(refundable)} of receipt ${r.no} can be refunded`);
    const instrumentNo = clean(input.instrumentNo);
    if (INSTRUMENT_MODES.includes(input.mode) && !instrumentNo) throw new BadRequestException(`Enter the ${input.mode} number`);

    // Take the refund from the receipt's lines in order, after what earlier refunds already took.
    const taken = new Map<string, number>();
    for (const f of r.refunds) for (const x of f.allocation as { invoiceId: string; amount: number }[]) taken.set(x.invoiceId, (taken.get(x.invoiceId) ?? 0) + x.amount);
    let left = amount;
    const allocation: { invoiceId: string; amount: number }[] = [];
    for (const l of r.lines) {
      const c = Math.min(left, l.fee - (taken.get(l.invoiceId) ?? 0));
      if (c > 0) {
        allocation.push({ invoiceId: l.invoiceId, amount: c });
        left -= c;
      }
    }
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    await this.prisma.$transaction(async (tx) => {
      for (const x of allocation) await tx.feeInvoice.update({ where: { id: x.invoiceId }, data: { refunded: { increment: x.amount } } });
      await tx.feeRefund.create({
        data: {
          tenantId: r.tenantId,
          branchId: r.branchId,
          studentId: r.studentId,
          receiptId: r.id,
          amount,
          date: dayDate(todayIST()),
          mode: input.mode,
          bank: clean(input.bank),
          instrumentNo,
          remarks,
          allocation,
          createdById: user.id,
          createdByName: actor.name,
        },
      });
    });
    await this.audit.record({ tenantId: r.tenantId, actorId: user.id, action: 'fee.refund', entity: 'FeeReceipt', entityId: r.id, data: { no: r.no, amount, mode: input.mode, remarks } });
    return receiptDto(await this.prisma.feeReceipt.findUniqueOrThrow({ where: { id: r.id }, include: receiptInclude }));
  }

  /** A student's corrections, newest first (staff only; parents see the effect in their invoices). */
  async studentCorrections(user: AuthUser, studentId: string): Promise<CorrectionDto[]> {
    FeesService.assertStaff(user);
    const s = await this.collection.findStudent(user, studentId);
    const rows = await this.prisma.feeCorrection.findMany({ where: { studentId: s.id }, include: correctionInclude, orderBy: { createdAt: 'desc' } });
    return rows.map(toDto);
  }

  // ================= reminders =================

  /** SMS the primary guardian of every student with an overdue balance (once per student per day). */
  async sendReminders(user: AuthUser, input: ReminderInput): Promise<ReminderResult> {
    const report = await this.dues(user, { branchId: input.branchId, classId: input.classId, overdueOnly: true });
    const guardians = await this.prisma.studentGuardian.findMany({ where: { studentId: { in: report.rows.map((r) => r.studentId) }, primary: true }, include: { user: true } });
    const tenantId = requireTenant(user);
    let sent = 0;
    for (const r of report.rows) {
      const g = guardians.find((x) => x.studentId === r.studentId)?.user ?? null;
      if (await this.notifications.feeReminder(tenantId, r, g, report.asOf)) sent++;
    }
    await this.audit.record({ tenantId, actorId: user.id, action: 'fee.reminders', entity: 'Notification', data: { sent, students: report.rows.length, branchId: input.branchId ?? null, classId: input.classId ?? null } });
    return { sent, skipped: report.rows.length - sent };
  }

  // ================= reports =================

  /** Students with something unpaid on confirmed fees: who owes what, since when, and the late fee today. */
  async dues(user: AuthUser, q: { branchId?: string; classId?: string; overdueOnly?: boolean; academicYearId?: string }): Promise<DuesReportDto> {
    FeesService.assertStaff(user);
    const year = await this.scope.year(user, q.academicYearId);
    const filter = await this.scope.branchFilter(user, q.branchId);
    const today = todayIST();
    const invoices = await this.prisma.feeInvoice.findMany({
      where: { assignment: { status: { in: COLLECTABLE }, feeType: { academicYearId: year.id }, student: { ...filter, ...(q.classId ? { classId: q.classId } : {}) } } },
      include: {
        assignment: {
          select: {
            feeType: { select: { name: true, kind: true } },
            student: {
              select: {
                id: true,
                name: true,
                admissionNo: true,
                class: { select: { name: true, grade: true, section: true } },
                branch: { select: { name: true, settings: true } },
                guardians: { where: { primary: true }, select: { user: { select: { name: true, phone: true } } }, take: 1 },
              },
            },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
    });
    const byStudent = new Map<string, DuesRow & { order: string }>();
    for (const i of invoices) {
      const s = i.assignment.student;
      const balance = balanceOf(i);
      let row = byStudent.get(s.id);
      if (!row) {
        const g = s.guardians[0]?.user;
        row = {
          studentId: s.id,
          studentName: s.name,
          admissionNo: s.admissionNo,
          className: s.class?.name ?? null,
          branchName: s.branch.name,
          guardian: g ? { name: g.name, phone: g.phone } : null,
          billed: 0,
          concession: 0,
          paid: 0,
          balance: 0,
          overdue: 0,
          lateFee: 0,
          dues: [],
          order: `${s.branch.name}|${String((s.class?.grade ?? -9) + 10).padStart(3, '0')}|${s.class?.section ?? ''}|${s.name}`,
        };
        byStudent.set(s.id, row);
      }
      const dueDate = dayString(i.dueDate);
      row.billed += i.gross - i.adjustment;
      row.concession += i.concession;
      row.paid += i.paid;
      if (balance > 0) {
        row.balance += balance;
        if (dueDate < today) row.overdue += balance;
        row.lateFee += lateFee({ balance, dueDate, fineFrom: i.fineFrom ? dayString(i.fineFrom) : null }, today, chargesLateFee(i.assignment.feeType.kind) ? lateFeePerDay(s.branch.settings) : 0);
        row.dues.push({ label: `${i.assignment.feeType.name} · ${i.label}`, dueDate, balance });
      }
    }
    const rows = [...byStudent.values()]
      .filter((r) => (q.overdueOnly ? r.overdue > 0 : r.balance > 0))
      .sort((a, b) => a.order.localeCompare(b.order))
      .map(({ order: _o, ...r }) => r);
    return {
      asOf: today,
      rows,
      totals: { students: rows.length, balance: rows.reduce((n, r) => n + r.balance, 0), overdue: rows.reduce((n, r) => n + r.overdue, 0), lateFee: rows.reduce((n, r) => n + r.lateFee, 0) },
    };
  }

  /** Class-wise totals for the year, like the existing system's class-level and management summaries. */
  async classSummary(user: AuthUser, q: { branchId?: string; academicYearId?: string }): Promise<ClassSummaryDto> {
    FeesService.assertStaff(user);
    const year = await this.scope.year(user, q.academicYearId);
    const filter = await this.scope.branchFilter(user, q.branchId);
    const today = todayIST();
    const [classes, invoices] = await Promise.all([
      this.prisma.schoolClass.findMany({
        where: { ...filter, academicYearId: year.id },
        include: { branch: { select: { name: true } }, _count: { select: { students: { where: { status: { in: ['Active', 'Temporary'] } } } } } },
        orderBy: [{ branch: { name: 'asc' } }, { grade: 'asc' }, { section: 'asc' }],
      }),
      this.prisma.feeInvoice.findMany({
        where: { assignment: { status: { in: COLLECTABLE }, feeType: { academicYearId: year.id }, student: filter } },
        select: { gross: true, concession: true, adjustment: true, paid: true, refunded: true, finePaid: true, fineWaived: true, dueDate: true, assignment: { select: { student: { select: { classId: true } } } } },
      }),
    ]);
    const empty = () => ({ students: 0, billed: 0, concession: 0, adjustment: 0, collected: 0, refunded: 0, balance: 0, overdue: 0, finePaid: 0, fineWaived: 0 });
    const sums = new Map<string | null, ReturnType<typeof empty>>();
    for (const i of invoices) {
      const k = i.assignment.student.classId;
      const t = sums.get(k) ?? empty();
      const bal = Math.max(0, balanceOf(i));
      t.billed += i.gross;
      t.concession += i.concession;
      t.adjustment += i.adjustment;
      t.collected += i.paid - i.refunded;
      t.refunded += i.refunded;
      t.balance += bal;
      if (dayString(i.dueDate) < today) t.overdue += bal;
      t.finePaid += i.finePaid;
      t.fineWaived += i.fineWaived;
      sums.set(k, t);
    }
    const rows: ClassSummaryRow[] = classes.map((c) => ({ classId: c.id, className: c.name, branchName: c.branch.name, ...(sums.get(c.id) ?? empty()), students: c._count.students }));
    const orphan = sums.get(null);
    if (orphan) rows.push({ classId: null, className: 'No class', branchName: '—', ...orphan });
    const totals = rows.reduce((t, r) => {
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k];
      return t;
    }, empty());
    return { academicYear: year.label, rows, totals };
  }

  /** Concessions, write-offs, waivers, refunds and cancelled receipts in a date range. */
  async correctionsReport(user: AuthUser, q: { branchId?: string; from?: string; to?: string; kind?: string }): Promise<CorrectionsReportDto> {
    FeesService.assertStaff(user);
    const today = todayIST();
    const from = q.from || addDays(today, -30);
    const to = q.to || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequestException('Choose a valid date range');
    const filter = await this.scope.branchFilter(user, q.branchId);
    const branchWhere = { branchId: filter.branchId, tenantId: requireTenant(user) };
    // Created-at times are compared on India dates.
    const range = { gte: new Date(dayDate(from).getTime() - IST_MS), lt: new Date(dayDate(addDays(to, 1)).getTime() - IST_MS) };
    const want = (k: string) => !q.kind || q.kind === k;
    const [corrections, refunds, cancellations] = await Promise.all([
      this.prisma.feeCorrection.findMany({ where: { ...branchWhere, createdAt: range, ...(q.kind && q.kind !== 'REFUND' && q.kind !== 'CANCELLED' ? { kind: q.kind } : {}) }, include: correctionInclude, orderBy: { createdAt: 'desc' } }),
      want('REFUND') ? this.prisma.feeRefund.findMany({ where: { ...branchWhere, date: { gte: dayDate(from), lte: dayDate(to) } }, include: { receipt: { include: { student: { select: { name: true, admissionNo: true, class: { select: { name: true } } } }, branch: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } }) : [],
      want('CANCELLED') ? this.prisma.feeReceipt.findMany({ where: { ...branchWhere, status: 'CANCELLED', cancelledAt: range }, include: receiptInclude, orderBy: { cancelledAt: 'desc' } }) : [],
    ]);
    const kept = q.kind === 'REFUND' || q.kind === 'CANCELLED' ? [] : corrections;
    const sum = (k: CorrectionKind) => kept.filter((c) => c.kind === k).reduce((n, c) => n + c.amount, 0);
    const cancelled = cancellations.map((r) => ({ ...receiptDto(r), cancelledAt: r.cancelledAt!.toISOString(), cancelReason: r.cancelReason }));
    return {
      from,
      to,
      corrections: kept.map(toDto),
      refunds: refunds.map((f) => refundDto(f)),
      cancellations: cancelled.map(({ lines: _l, refunds: _r, ...c }) => c) as CorrectionsReportDto['cancellations'],
      totals: { concession: sum('CONCESSION'), adjustment: sum('ADJUSTMENT'), fineWaiver: sum('FINE_WAIVER'), refund: refunds.reduce((n, f) => n + f.amount, 0), cancelled: cancelled.reduce((n, r) => n + r.total, 0) },
    };
  }

  // ---------- helpers ----------

  private async findAssignment(user: AuthUser, id: string): Promise<AssignmentFull> {
    FeesService.assertStaff(user);
    const a = await this.prisma.feeAssignment.findUnique({ where: { id }, include: assignmentInclude });
    if (!a) throw new NotFoundException('Fee not found');
    await this.collection.findStudent(user, a.studentId).catch(() => {
      throw new NotFoundException('Fee not found');
    });
    return a;
  }

  private reason(raw: string | null | undefined): string {
    const r = clean(raw);
    if (!r || r.length < 3) throw new BadRequestException('Give a reason (it appears on the reports)');
    return r;
  }

  private async record(tx: Prisma.TransactionClient, user: AuthUser, a: AssignmentFull, kind: CorrectionKind, amount: number, detail: object, remarks: string): Promise<CorrectionFull> {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    return tx.feeCorrection.create({
      data: { tenantId: a.student.branch.tenantId, branchId: a.student.branchId, studentId: a.studentId, assignmentId: a.id, kind, amount, detail: detail as Prisma.InputJsonValue, remarks, createdById: user.id, createdByName: actor.name },
      include: correctionInclude,
    });
  }
}

const toDto = (c: CorrectionFull): CorrectionDto => ({
  id: c.id,
  kind: c.kind as CorrectionKind,
  studentId: c.studentId,
  studentName: c.student.name,
  admissionNo: c.student.admissionNo,
  className: c.student.class?.name ?? null,
  branchName: c.student.branch.name,
  feeTypeName: c.assignment.feeType.name,
  amount: c.amount,
  remarks: c.remarks,
  lines: ((c.detail as { lines?: { label: string; amount: number }[] }).lines ?? []).map((l) => ({ label: l.label, amount: l.amount })),
  createdByName: c.createdByName,
  createdAt: c.createdAt.toISOString(),
});
