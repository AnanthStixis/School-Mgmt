import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PaymentAttempt, Prisma } from '@prisma/client';
import { lateFee, type DevOutcome, type OnlinePaymentsReportDto, type PaymentAttemptDto, type PaymentLine, type PaymentStatus, type StartPaymentDto, type StartPaymentInput } from '@sms/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { addDays, dayDate, dayString, todayIST } from '../common/dates';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { CollectionService, fineFromOf, net, type PlannedLine } from '../fees/collection.service';
import { FeesService, lateFeePerDay } from '../fees/fees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevGateway, PAYMENT_GATEWAY, type GatewayResult, type PaymentGateway } from './gateway';

const IST_MS = 5.5 * 3_600_000;
const DEV_CODES: Record<DevOutcome, { status: GatewayResult['status']; code: number; message: string }> = {
  success: { status: 'SUCCESS', code: 0, message: 'SUCCESSFUL' },
  declined: { status: 'FAILED', code: 1072, message: 'Payment declined by bank' },
  failed: { status: 'FAILED', code: 1000, message: 'Payment failed' },
  pending: { status: 'PENDING', code: 1006, message: 'Waiting for response from bank' },
};

const attemptInclude = {
  student: { select: { name: true, admissionNo: true, class: { select: { name: true } }, branch: { select: { name: true } }, guardians: { select: { userId: true } } } },
} satisfies Prisma.PaymentAttemptInclude;
type AttemptFull = Prisma.PaymentAttemptGetPayload<{ include: typeof attemptInclude }>;

/**
 * Online fee payments. A parent pays whole installments (balance + today's late fee) of fees Accounts
 * has published with online payment on. Each attempt is recorded before the parent leaves for the
 * gateway; the gateway's signed answer (webhook) decides the outcome. A successful payment issues a
 * receipt exactly like the counter does, once, however many times the gateway repeats itself.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly collection: CollectionService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async start(user: AuthUser, input: StartPaymentInput): Promise<StartPaymentDto> {
    if (user.role !== 'parent') throw new ForbiddenException('Online payment is for parents; use Collect at the counter');
    const s = await this.collection.findStudent(user, input.studentId);
    const ids = [...new Set(input.invoiceIds)];
    if (!ids.length) throw new BadRequestException('Choose at least one installment');
    const invoices = await this.prisma.feeInvoice.findMany({ where: { id: { in: ids }, studentId: s.id }, include: { assignment: { include: { feeType: { select: { name: true } } } } }, orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }] });
    if (invoices.length !== ids.length) throw new NotFoundException('Installment not found');
    const pending = await this.prisma.paymentAttempt.findFirst({ where: { studentId: s.id, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (pending) throw new ConflictException(`An earlier payment (${pending.orderId}) is still waiting for the bank. Please try again after it completes.`);

    const today = todayIST();
    const perDay = lateFeePerDay(s.branch.settings);
    const lines: PaymentLine[] = invoices.map((i) => {
      const label = `${i.assignment.feeType.name} · ${i.label}`;
      if (i.assignment.status !== 'PUBLISHED' || !i.assignment.onlineEnabled) throw new BadRequestException(`${label} can't be paid online yet; please pay at the school office`);
      const balance = net(i) - i.paid;
      if (balance <= 0) throw new BadRequestException(`${label} is already paid`);
      return { invoiceId: i.id, label, fee: balance, fine: lateFee({ balance, dueDate: dayString(i.dueDate), fineFrom: fineFromOf(i) }, today, perDay) };
    });
    const amount = lines.reduce((n, l) => n + l.fee + l.fine, 0);
    const orderId = `${s.branch.code}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    await this.prisma.paymentAttempt.create({
      data: { tenantId: s.branch.tenantId, branchId: s.branchId, studentId: s.id, orderId, gateway: this.gateway.name, amount, lines: lines as unknown as Prisma.InputJsonValue, initiatedById: user.id },
    });
    await this.audit.record({ tenantId: s.branch.tenantId, actorId: user.id, action: 'payment.start', entity: 'PaymentAttempt', entityId: orderId, data: { studentId: s.id, amount } });
    return { orderId, amount, gateway: this.gateway.name, checkoutUrl: this.gateway.checkoutUrl({ orderId, amount }) };
  }

  /** One attempt: the parent who can see the student, or staff in scope. */
  async get(user: AuthUser, orderId: string): Promise<PaymentAttemptDto> {
    return this.toDto(await this.find(user, orderId));
  }

  /** The development gateway's checkout page answers here; it then "calls the webhook" like a real gateway. */
  async devComplete(user: AuthUser, orderId: string, outcome: DevOutcome, mode: string): Promise<PaymentAttemptDto> {
    if (!(this.gateway instanceof DevGateway)) throw new NotFoundException();
    const a = await this.find(user, orderId);
    if (a.initiatedById !== user.id) throw new ForbiddenException('Only the parent who started this payment can complete it');
    const c = DEV_CODES[outcome];
    const { body, signature } = this.gateway.sign({ orderId, status: c.status, code: c.code, message: c.message, amount: a.amount, mode: c.status === 'FAILED' && outcome === 'failed' ? null : mode, txnId: `OW${randomBytes(7).toString('hex').toUpperCase()}` });
    await this.webhook(this.gateway.name, body, signature);
    return this.get(user, orderId);
  }

  /** The gateway's server-to-server notification. Safe to receive more than once. */
  async webhook(gatewayName: string, body: unknown, signature: string | undefined): Promise<{ ok: true }> {
    if (gatewayName !== this.gateway.name) throw new NotFoundException('Unknown gateway');
    const r = this.gateway.parseWebhook(body, signature);
    if (!r) throw new UnauthorizedException('Invalid signature');
    await this.apply(r);
    return { ok: true };
  }

  /** Staff report: every attempt in a date range, with what the gateway answered. */
  async report(user: AuthUser, q: { branchId?: string; from?: string; to?: string; status?: string }): Promise<OnlinePaymentsReportDto> {
    FeesService.assertStaff(user);
    const today = todayIST();
    const from = q.from || today;
    const to = q.to || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new BadRequestException('Choose a valid date range');
    const filter = await this.scope.branchFilter(user, q.branchId);
    const rows = await this.prisma.paymentAttempt.findMany({
      where: {
        tenantId: requireTenant(user),
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        createdAt: { gte: new Date(dayDate(from).getTime() - IST_MS), lt: new Date(dayDate(addDays(to, 1)).getTime() - IST_MS) },
        ...(q.status ? { status: q.status } : {}),
      },
      include: attemptInclude,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    const dtos = await Promise.all(rows.map((r) => this.toDto(r)));
    const count = (s: PaymentStatus) => rows.filter((r) => r.status === s).length;
    return {
      from,
      to,
      rows: dtos,
      totals: {
        attempts: rows.length,
        success: count('SUCCESS'),
        failed: count('FAILED'),
        pending: count('PENDING'),
        notCompleted: count('INITIATED'),
        collected: rows.filter((r) => r.status === 'SUCCESS').reduce((n, r) => n + r.amount, 0),
        excess: rows.reduce((n, r) => n + r.excess, 0),
      },
    };
  }

  // ---------- helpers ----------

  private async apply(r: GatewayResult): Promise<void> {
    const a = await this.prisma.paymentAttempt.findUnique({ where: { orderId: r.orderId } });
    if (!a) throw new NotFoundException('Unknown order');
    if (a.status === 'SUCCESS' || a.status === 'FAILED') return; // already settled: gateways repeat themselves
    const done = { code: r.code, message: r.message, mode: r.mode, gatewayTxnId: r.txnId };
    if (r.amount !== a.amount) {
      this.log.error(`Order ${a.orderId}: gateway amount ${r.amount} ≠ order amount ${a.amount}`);
      await this.prisma.paymentAttempt.update({ where: { id: a.id }, data: { ...done, status: 'FAILED', message: `Amount mismatch (gateway ${r.amount}, order ${a.amount}): check with the gateway`, completedAt: new Date() } });
      return;
    }
    if (r.status !== 'SUCCESS') {
      await this.prisma.paymentAttempt.update({ where: { id: a.id }, data: { ...done, status: r.status, completedAt: r.status === 'FAILED' ? new Date() : null } });
      return;
    }
    // Success: issue the receipt. Retry once if the installment changed underneath (e.g. a counter payment at the same moment).
    for (let attempt = 1; ; attempt++) {
      try {
        await this.settle(a, r);
        return;
      } catch (e) {
        if (!(e instanceof ConflictException) || attempt >= 2) throw e;
      }
    }
  }

  private async settle(a: PaymentAttempt, r: GatewayResult): Promise<void> {
    const lines = a.lines as unknown as PaymentLine[];
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: a.studentId }, include: { branch: { include: { tenant: { select: { receiptPrefix: true } } } } } });
    const year = await this.prisma.academicYear.findFirstOrThrow({ where: { tenantId: a.tenantId, current: true } });
    const parent = await this.prisma.user.findUniqueOrThrow({ where: { id: a.initiatedById }, select: { name: true } });
    const invoices = await this.prisma.feeInvoice.findMany({ where: { id: { in: lines.map((l) => l.invoiceId) } } });
    // Apply what is still owed; anything paid twice (e.g. at the counter meanwhile) is excess for Accounts to refund.
    const planned: PlannedLine[] = lines.map((l) => {
      const inv = invoices.find((i) => i.id === l.invoiceId)!;
      const fee = Math.min(l.fee, Math.max(0, net(inv) - inv.paid));
      return { inv, label: l.label, fee, fine: fee > 0 ? l.fine : 0, waived: 0 };
    });
    const applied = planned.reduce((n, p) => n + p.fee + p.fine, 0);
    const excess = a.amount - applied;
    const today = todayIST();

    const receiptId = await this.prisma.$transaction(async (tx) => {
      // Claim the attempt first so two webhook deliveries can't both issue a receipt.
      const claimed = await tx.paymentAttempt.updateMany({ where: { id: a.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'SUCCESS' } });
      if (!claimed.count) return null;
      let rid: string | null = null;
      if (applied > 0) {
        const receipt = await this.collection.writeReceipt(tx, {
          tenantId: a.tenantId,
          branchId: a.branchId,
          studentId: a.studentId,
          prefix: student.branch.tenant.receiptPrefix,
          year,
          today,
          planned,
          mode: r.mode ?? 'UPI',
          source: 'Online',
          reference: r.txnId,
          remarks: `Online order ${a.orderId}${excess ? ` · ₹${excess.toLocaleString('en-IN')} paid in excess, to be refunded` : ''}`,
          recon: 'NA',
          createdById: a.initiatedById,
          createdByName: `${parent.name} (online)`,
        });
        rid = receipt.id;
      }
      await tx.paymentAttempt.update({ where: { id: a.id }, data: { code: r.code, message: r.message, mode: r.mode, gatewayTxnId: r.txnId, receiptId: rid, excess, completedAt: new Date() } });
      return rid ?? '';
    });
    if (receiptId === null) return;
    await this.audit.record({ tenantId: a.tenantId, actorId: a.initiatedById, action: 'payment.success', entity: 'PaymentAttempt', entityId: a.orderId, data: { amount: a.amount, receiptId, excess } });
    if (receiptId) await this.notifications.receiptIssued(receiptId);
  }

  private async find(user: AuthUser, orderId: string): Promise<AttemptFull> {
    const tenantId = requireTenant(user);
    const notFound = new NotFoundException('Payment not found');
    const a = await this.prisma.paymentAttempt.findUnique({ where: { orderId }, include: attemptInclude });
    if (!a || a.tenantId !== tenantId) throw notFound;
    if (user.role === 'parent') {
      if (!a.student.guardians.some((g) => g.userId === user.id)) throw notFound;
    } else {
      FeesService.assertStaff(user);
      await this.scope.branch(user, a.branchId).catch(() => {
        throw notFound;
      });
    }
    return a;
  }

  private async toDto(a: AttemptFull): Promise<PaymentAttemptDto> {
    const receipt = a.receiptId ? await this.prisma.feeReceipt.findUnique({ where: { id: a.receiptId }, select: { no: true } }) : null;
    return {
      id: a.id,
      orderId: a.orderId,
      gateway: a.gateway,
      studentId: a.studentId,
      studentName: a.student.name,
      admissionNo: a.student.admissionNo,
      className: a.student.class?.name ?? null,
      branchName: a.student.branch.name,
      amount: a.amount,
      lines: a.lines as unknown as PaymentLine[],
      status: a.status as PaymentStatus,
      code: a.code,
      message: a.message,
      mode: a.mode,
      gatewayTxnId: a.gatewayTxnId,
      receiptId: a.receiptId,
      receiptNo: receipt?.no ?? null,
      excess: a.excess,
      createdAt: a.createdAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
    };
  }
}
