import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  INSTRUMENT_MODES,
  lateFee,
  RECON_MODES,
  rupeesInWords,
  type CollectableInvoice,
  type CollectDto,
  type CollectInput,
  type PaymentMode,
  type ReceiptDto,
  type ReceiptListItem,
  type ReceiptRegisterDto,
  type ReceiptStatus,
  type ReconStatus,
  type RefundDto,
} from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { addDays, dayDate, dayString, todayIST } from '../common/dates';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { clean } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { FeesService, lateFeePerDay } from './fees.service';

/** Assignments Accounts has checked; drafts (ASSIGNED) can't be collected yet. */
const COLLECTABLE = ['CONFIRMED', 'PUBLISHED'];
/** Banks don't honour a cheque older than three months. */
const INSTRUMENT_VALID_DAYS = 90;
const REGISTER_MAX_DAYS = 366;

export const receiptInclude = {
  student: { select: { name: true, admissionNo: true, class: { select: { name: true } }, guardians: { select: { userId: true } } } },
  branch: { select: { name: true, address: true, tenant: { select: { name: true, trust: true } } } },
  academicYear: { select: { label: true } },
  lines: { orderBy: { id: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FeeReceiptInclude;
export type ReceiptFull = Prisma.FeeReceiptGetPayload<{ include: typeof receiptInclude }>;

const net = (i: { gross: number; concession: number; adjustment: number }) => i.gross - i.concession - i.adjustment;
const fineFromOf = (i: { fineFrom: Date | null }) => (i.fineFrom ? dayString(i.fineFrom) : null);

/**
 * Counter fee collection. Each payment produces one receipt with a number from a single school-wide
 * series per academic year. Payments can part-pay an installment; the late fee on each installment
 * is collected, waived (with a reason) or left running. Receipts are never deleted: a mistake is
 * corrected by cancelling the receipt, which reverses exactly what it applied.
 */
@Injectable()
export class CollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Everything the counter screen needs for one student. */
  async collectView(user: AuthUser, studentId: string): Promise<CollectDto> {
    FeesService.assertStaff(user);
    const s = await this.findStudent(user, studentId);
    const today = todayIST();
    const perDay = lateFeePerDay(s.branch.settings);
    const [invoices, unconfirmed, receipts] = await Promise.all([
      this.prisma.feeInvoice.findMany({
        where: { studentId, assignment: { status: { in: COLLECTABLE } } },
        include: { assignment: { include: { feeType: { include: { academicYear: { select: { label: true } } } } } } },
        orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
      }),
      this.prisma.feeAssignment.count({ where: { studentId, status: 'ASSIGNED' } }),
      this.prisma.feeReceipt.findMany({ where: { studentId }, include: receiptInclude, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const rows: CollectableInvoice[] = invoices
      .map((i) => {
        const balance = net(i) - i.paid;
        const dueDate = dayString(i.dueDate);
        const fine = lateFee({ balance, dueDate, fineFrom: fineFromOf(i) }, today, perDay);
        return {
          invoiceId: i.id,
          feeTypeName: i.assignment.feeType.name,
          academicYear: i.assignment.feeType.academicYear.label,
          label: i.label,
          dueDate,
          net: net(i),
          paid: i.paid,
          balance,
          lateFee: fine,
          daysLate: perDay ? fine / perDay : 0,
        };
      })
      .filter((i) => i.balance > 0);
    return {
      studentId: s.id,
      name: s.name,
      admissionNo: s.admissionNo,
      className: s.class?.name ?? null,
      branchId: s.branchId,
      branchName: s.branch.name,
      lateFeePerDay: perDay,
      today,
      invoices: rows,
      unconfirmed,
      receipts: receipts.map(listItem),
    };
  }

  async collect(user: AuthUser, input: CollectInput): Promise<ReceiptDto> {
    FeesService.assertStaff(user);
    const s = await this.findStudent(user, input.studentId);
    const year = await this.scope.year(user);
    const today = todayIST();
    const perDay = lateFeePerDay(s.branch.settings);
    const mode = input.mode;

    // ---- instrument details ----
    const bank = clean(input.bank);
    const instrumentNo = clean(input.instrumentNo);
    const instrumentDate = clean(input.instrumentDate);
    if (INSTRUMENT_MODES.includes(mode)) {
      if (!bank || !instrumentNo || !instrumentDate) throw new BadRequestException(`${mode}: enter the bank, ${mode} number and date`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(instrumentDate)) throw new BadRequestException(`${mode} date must be YYYY-MM-DD`);
      if (instrumentDate > today) throw new BadRequestException(`A post-dated ${mode} can't be receipted until its date (${instrumentDate})`);
      if (instrumentDate < addDays(today, -INSTRUMENT_VALID_DAYS)) throw new BadRequestException(`This ${mode} is more than three months old and will not be honoured by the bank`);
    }

    // ---- lines ----
    const ids = input.lines.map((l) => l.invoiceId);
    if (!ids.length) throw new BadRequestException('Choose at least one installment');
    if (new Set(ids).size !== ids.length) throw new BadRequestException('An installment is listed twice');
    const invoices = await this.prisma.feeInvoice.findMany({
      where: { id: { in: ids }, studentId: s.id },
      include: { assignment: { include: { feeType: { include: { academicYear: { select: { label: true } } } } } } },
    });
    const waiveReason = clean(input.waiveReason);
    const planned = input.lines.map((l) => {
      const inv = invoices.find((i) => i.id === l.invoiceId);
      if (!inv) throw new NotFoundException('Installment not found for this student');
      const label = `${inv.assignment.feeType.name} · ${inv.label}`;
      if (!COLLECTABLE.includes(inv.assignment.status)) throw new BadRequestException(`${label} has not been confirmed by Accounts yet`);
      const balance = net(inv) - inv.paid;
      const due = lateFee({ balance, dueDate: dayString(inv.dueDate), fineFrom: fineFromOf(inv) }, today, perDay);
      if (!Number.isInteger(l.fee) || l.fee < 0) throw new BadRequestException(`Enter the amount for ${label} in whole rupees`);
      if (l.fee > balance) throw new BadRequestException(`₹${l.fee} is more than the ₹${balance} left on ${label}`);
      if (l.fine === 'defer' && due > 0 && l.fee === balance) throw new BadRequestException(`${label} is being cleared: collect or waive its ₹${due} late fee`);
      if (l.fine === 'waive' && due > 0 && !waiveReason) throw new BadRequestException('Give a reason for waiving the late fee');
      const fine = l.fine === 'pay' ? due : 0;
      const waived = l.fine === 'waive' ? due : 0;
      return { inv, label, fee: l.fee, fine, waived };
    });
    const feeTotal = planned.reduce((n, p) => n + p.fee, 0);
    const fineTotal = planned.reduce((n, p) => n + p.fine, 0);
    if (feeTotal + fineTotal <= 0) throw new BadRequestException('Nothing to collect: enter an amount');

    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });
    const waivedTotal = planned.reduce((n, p) => n + p.waived, 0);
    const remarks = [clean(input.remarks), waivedTotal ? `Late fee ₹${waivedTotal.toLocaleString('en-IN')} waived: ${waiveReason}` : null].filter(Boolean).join(' · ') || null;

    const receipt = await this.prisma.$transaction(async (tx) => {
      const seq = await tx.receiptSequence.upsert({
        where: { tenantId_yearLabel: { tenantId: s.branch.tenantId, yearLabel: year.label } },
        create: { tenantId: s.branch.tenantId, yearLabel: year.label, last: 1 },
        update: { last: { increment: 1 } },
      });
      for (const p of planned) {
        if (!p.fee && !p.fine && !p.waived) continue;
        // Optimistic check: refuse if someone else changed this installment since we read it.
        const { count } = await tx.feeInvoice.updateMany({
          where: { id: p.inv.id, paid: p.inv.paid, finePaid: p.inv.finePaid, fineWaived: p.inv.fineWaived },
          data: {
            paid: { increment: p.fee },
            finePaid: { increment: p.fine },
            fineWaived: { increment: p.waived },
            ...(p.fine || p.waived ? { fineFrom: dayDate(today) } : {}),
          },
        });
        if (count !== 1) throw new ConflictException(`${p.label} changed while you were collecting. Reload and try again.`);
      }
      return tx.feeReceipt.create({
        data: {
          tenantId: s.branch.tenantId,
          branchId: s.branchId,
          studentId: s.id,
          academicYearId: year.id,
          no: `${s.branch.tenant.receiptPrefix}/${year.label}/${String(seq.last).padStart(4, '0')}`,
          date: dayDate(today),
          mode,
          source: 'Counter',
          feeTotal,
          fineTotal,
          total: feeTotal + fineTotal,
          bank,
          instrumentNo,
          instrumentDate: instrumentDate ? dayDate(instrumentDate) : null,
          reference: clean(input.reference),
          remarks,
          recon: RECON_MODES.includes(mode) ? 'PENDING' : 'NA',
          createdById: user.id,
          createdByName: actor.name,
          lines: {
            create: planned
              .filter((p) => p.fee || p.fine || p.waived)
              .map((p) => ({ invoiceId: p.inv.id, label: p.label, fee: p.fee, fine: p.fine, fineWaived: p.waived, prevFineFrom: p.inv.fineFrom })),
          },
        },
        include: receiptInclude,
      });
    });

    await this.audit.record({ tenantId: receipt.tenantId, actorId: user.id, action: 'fee.collect', entity: 'FeeReceipt', entityId: receipt.id, data: { no: receipt.no, studentId: s.id, mode, fee: feeTotal, fine: fineTotal } });
    if (waivedTotal) {
      await this.audit.record({ tenantId: receipt.tenantId, actorId: user.id, action: 'fee.fine_waive', entity: 'FeeReceipt', entityId: receipt.id, data: { no: receipt.no, studentId: s.id, amount: waivedTotal, reason: waiveReason } });
    }
    return receiptDto(receipt);
  }

  /** Reverses a receipt. Only the newest receipt on an installment can be cancelled, so the reversal is exact. */
  async cancel(user: AuthUser, id: string, reason: string, opts: { recon?: ReconStatus } = {}): Promise<ReceiptDto> {
    FeesService.assertStaff(user);
    const r = await this.findReceipt(user, id);
    if (r.status !== 'SUCCESS') throw new BadRequestException(`Receipt ${r.no} is already cancelled`);
    const why = clean(reason);
    if (!why || why.length < 3) throw new BadRequestException('Give a reason for cancelling the receipt');

    const later = await this.prisma.feeReceiptLine.findFirst({
      where: { invoiceId: { in: r.lines.map((l) => l.invoiceId) }, receipt: { status: 'SUCCESS', createdAt: { gt: r.createdAt } } },
      include: { receipt: { select: { no: true } } },
    });
    if (later) throw new BadRequestException(`Receipt ${later.receipt.no} was issued later for the same installment; cancel it first`);
    if (r.refunds.length) throw new BadRequestException(`Receipt ${r.no} has refunds against it and can't be cancelled`);

    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.feeReceipt.updateMany({ where: { id: r.id, status: 'SUCCESS' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: why, recon: opts.recon ?? 'NA' } });
      if (count !== 1) throw new ConflictException(`Receipt ${r.no} was just cancelled by someone else`);
      for (const l of r.lines) {
        await tx.feeInvoice.update({
          where: { id: l.invoiceId },
          data: { paid: { decrement: l.fee }, finePaid: { decrement: l.fine }, fineWaived: { decrement: l.fineWaived }, ...(l.fine || l.fineWaived ? { fineFrom: l.prevFineFrom } : {}) },
        });
      }
      return tx.feeReceipt.findUniqueOrThrow({ where: { id: r.id }, include: receiptInclude });
    });
    await this.audit.record({ tenantId: r.tenantId, actorId: user.id, action: 'fee.receipt_cancel', entity: 'FeeReceipt', entityId: r.id, data: { no: r.no, total: r.total, reason: why } });
    return receiptDto(done);
  }

  /** Cheque / net banking: mark the money as received, or as failed (bounced), which cancels the receipt. */
  async reconcile(user: AuthUser, id: string, ok: boolean, note?: string): Promise<ReceiptDto> {
    FeesService.assertStaff(user);
    const r = await this.findReceipt(user, id);
    if (r.recon !== 'PENDING' || r.status !== 'SUCCESS') throw new BadRequestException(`Receipt ${r.no} is not waiting for reconciliation`);
    if (!ok) return this.cancel(user, id, `Failed reconciliation: ${clean(note) ?? (r.mode === 'Cheque' ? 'cheque bounced' : 'bank did not credit')}`, { recon: 'FAILED' });
    const u = await this.prisma.feeReceipt.update({ where: { id }, data: { recon: 'DONE' }, include: receiptInclude });
    await this.audit.record({ tenantId: r.tenantId, actorId: user.id, action: 'fee.receipt_reconcile', entity: 'FeeReceipt', entityId: r.id, data: { no: r.no } });
    return receiptDto(u);
  }

  /** Receipts in a date range (default today), with totals by mode. */
  async register(user: AuthUser, q: { branchId?: string; from?: string; to?: string; mode?: string; recon?: string }): Promise<ReceiptRegisterDto> {
    FeesService.assertStaff(user);
    const today = todayIST();
    const from = q.from || today;
    const to = q.to || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequestException('Choose a valid date range');
    if (to > addDays(from, REGISTER_MAX_DAYS)) throw new BadRequestException('Choose a range of at most one year');
    const filter = await this.scope.branchFilter(user, q.branchId);
    const rows = await this.prisma.feeReceipt.findMany({
      where: { ...filter, date: { gte: dayDate(from), lte: dayDate(to) }, ...(q.mode ? { mode: q.mode } : {}), ...(q.recon ? { recon: q.recon } : {}) },
      include: receiptInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    const ok = rows.filter((r) => r.status === 'SUCCESS');
    const byMode = new Map<string, { count: number; total: number }>();
    for (const r of ok) {
      const m = byMode.get(r.mode) ?? { count: 0, total: 0 };
      m.count++;
      m.total += r.total;
      byMode.set(r.mode, m);
    }
    return {
      from,
      to,
      rows: rows.map(listItem),
      totals: {
        count: ok.length,
        fee: ok.reduce((n, r) => n + r.feeTotal, 0),
        fine: ok.reduce((n, r) => n + r.fineTotal, 0),
        total: ok.reduce((n, r) => n + r.total, 0),
        byMode: [...byMode].map(([mode, v]) => ({ mode: mode as PaymentMode, ...v })).sort((a, b) => b.total - a.total),
      },
      cancelled: rows.length - ok.length,
    };
  }

  /** One receipt: staff in scope, or a parent of the student. */
  async receipt(user: AuthUser, id: string): Promise<ReceiptDto> {
    return receiptDto(await this.findReceipt(user, id));
  }

  /** A student's receipts, newest first (for the parent's fee screen and the student profile). */
  async studentReceipts(user: AuthUser, studentId: string): Promise<ReceiptListItem[]> {
    const s = await this.findStudent(user, studentId);
    const rows = await this.prisma.feeReceipt.findMany({ where: { studentId: s.id }, include: receiptInclude, orderBy: { createdAt: 'desc' } });
    return rows.map(listItem);
  }

  // ---------- helpers ----------

  async findStudent(user: AuthUser, studentId: string) {
    const tenantId = requireTenant(user);
    const notFound = new NotFoundException('Student not found');
    const s = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { class: { select: { name: true } }, branch: { include: { tenant: { select: { receiptPrefix: true } } } }, guardians: { select: { userId: true } } },
    });
    if (!s || s.branch.tenantId !== tenantId) throw notFound;
    await this.checkAccess(user, s.branchId, s.guardians, notFound);
    return s;
  }

  async findReceipt(user: AuthUser, id: string): Promise<ReceiptFull> {
    const tenantId = requireTenant(user);
    const notFound = new NotFoundException('Receipt not found');
    const r = await this.prisma.feeReceipt.findUnique({ where: { id }, include: receiptInclude });
    if (!r || r.tenantId !== tenantId) throw notFound;
    await this.checkAccess(user, r.branchId, r.student.guardians, notFound);
    return r;
  }

  /** Parents reach only their own children; staff (accounts, managers) only their branch scope. */
  private async checkAccess(user: AuthUser, branchId: string, guardians: { userId: string }[], notFound: NotFoundException) {
    if (user.role === 'parent') {
      if (!guardians.some((g) => g.userId === user.id)) throw notFound;
      return;
    }
    FeesService.assertStaff(user);
    await this.scope.branch(user, branchId).catch(() => {
      throw notFound;
    });
  }
}

const listItem = (r: ReceiptFull): ReceiptListItem => ({
  id: r.id,
  no: r.no,
  date: dayString(r.date),
  studentId: r.studentId,
  studentName: r.student.name,
  admissionNo: r.student.admissionNo,
  className: r.student.class?.name ?? null,
  branchName: r.branch.name,
  mode: r.mode as PaymentMode,
  source: r.source,
  status: r.status as ReceiptStatus,
  recon: r.recon as ReconStatus,
  feeTotal: r.feeTotal,
  fineTotal: r.fineTotal,
  total: r.total,
  createdByName: r.createdByName,
});

export const receiptDto = (r: ReceiptFull): ReceiptDto => ({
  ...listItem(r),
  schoolName: r.branch.tenant.name,
  trust: r.branch.tenant.trust,
  branchAddress: r.branch.address,
  academicYear: r.academicYear.label,
  lines: r.lines.map((l) => ({ invoiceId: l.invoiceId, label: l.label, fee: l.fee, fine: l.fine, fineWaived: l.fineWaived })),
  amountInWords: rupeesInWords(r.total),
  bank: r.bank,
  instrumentNo: r.instrumentNo,
  instrumentDate: r.instrumentDate ? dayString(r.instrumentDate) : null,
  reference: r.reference,
  remarks: r.remarks,
  createdAt: r.createdAt.toISOString(),
  cancelledAt: r.cancelledAt?.toISOString() ?? null,
  cancelReason: r.cancelReason,
  refunds: r.refunds.map((f) => refundDto({ ...f, receipt: r })),
  refundable: refundableOf(r),
});

/** Fee money on a receipt that can still be paid back. Late fees are not refundable; nothing is while the bank hasn't confirmed. */
export const refundableOf = (r: { status: string; recon: string; feeTotal: number; refunds: { amount: number }[] }) =>
  r.status !== 'SUCCESS' || r.recon === 'PENDING' ? 0 : r.feeTotal - r.refunds.reduce((n, f) => n + f.amount, 0);

export const refundDto = (
  f: Prisma.FeeRefundGetPayload<object> & { receipt: { no: string; studentId: string; student: { name: string; admissionNo: string; class: { name: string } | null }; branch: { name: string } } },
): RefundDto => ({
  id: f.id,
  receiptId: f.receiptId,
  receiptNo: f.receipt.no,
  date: dayString(f.date),
  studentId: f.studentId,
  studentName: f.receipt.student.name,
  admissionNo: f.receipt.student.admissionNo,
  className: f.receipt.student.class?.name ?? null,
  branchName: f.receipt.branch.name,
  amount: f.amount,
  mode: f.mode as PaymentMode,
  bank: f.bank,
  instrumentNo: f.instrumentNo,
  remarks: f.remarks,
  status: f.status,
  createdByName: f.createdByName,
  createdAt: f.createdAt.toISOString(),
});
