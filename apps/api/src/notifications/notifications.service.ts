import { Inject, Injectable, Logger } from '@nestjs/common';
import { SMS_SENDER, type SmsSender } from '../auth/sms';
import { PrismaService } from '../prisma/prisma.service';

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;

/**
 * Messages to parents. Each message is recorded first (queued → sent / failed) under a dedupe key,
 * so a retry, a double click or a re-sent webhook never messages the same parent twice.
 * Delivery goes through SMS_SENDER, which is the console in development until a provider is chosen.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  /** Sends one message to a user unless one with the same key was already recorded. Returns true if sent now. */
  async send(tenantId: string, user: { id: string; phone: string | null; active: boolean }, template: string, text: string, dedupeKey: string): Promise<boolean> {
    if (!user.phone || !user.active) return false;
    const created = await this.prisma.notification.createMany({ data: [{ tenantId, userId: user.id, template, text, dedupeKey }], skipDuplicates: true });
    if (!created.count) return false;
    try {
      await this.sms.send(user.phone, text);
      await this.prisma.notification.update({ where: { dedupeKey }, data: { status: 'sent', sentAt: new Date() } });
      return true;
    } catch (e) {
      this.log.warn(`${template} SMS to ${user.id} failed: ${(e as Error).message}`);
      await this.prisma.notification.update({ where: { dedupeKey }, data: { status: 'failed', error: (e as Error).message.slice(0, 300) } });
      return false;
    }
  }

  /** "Payment received" to the student's primary guardian. Never throws: a failed SMS must not undo a payment. */
  async receiptIssued(receiptId: string): Promise<void> {
    try {
      const r = await this.prisma.feeReceipt.findUnique({
        where: { id: receiptId },
        include: { lines: true, branch: { select: { name: true } }, student: { select: { name: true, guardians: { where: { primary: true }, include: { user: true } } } } },
      });
      if (!r) return;
      const what = r.lines.map((l) => l.label).join(', ');
      const text = `Received ${inr(r.total)} for ${r.student.name} towards ${what}. Receipt ${r.no}. Thank you - ${r.branch.name}.`;
      for (const g of r.student.guardians) await this.send(r.tenantId, g.user, 'receipt', text, `receipt:${r.id}:${g.userId}`);
    } catch (e) {
      this.log.warn(`Receipt SMS for ${receiptId} failed: ${(e as Error).message}`);
    }
  }

  /** Overdue-fee reminder to the primary guardian, at most once per student per day. */
  async feeReminder(
    tenantId: string,
    s: { studentId: string; studentName: string; className: string | null; branchName: string; overdue: number; lateFee: number; dues: { label: string; dueDate: string }[] },
    guardian: { id: string; phone: string | null; active: boolean } | null,
    today: string,
  ): Promise<boolean> {
    if (!guardian) return false;
    const oldest = s.dues[0];
    const text =
      `Fee reminder: ${inr(s.overdue)} is overdue for ${s.studentName}${s.className ? ` (${s.className})` : ''} at ${s.branchName}` +
      `${oldest ? `, oldest ${oldest.label} due ${oldest.dueDate}` : ''}.` +
      `${s.lateFee ? ` Late fee so far ${inr(s.lateFee)}.` : ''} Pay online in the parent app or at the school office.`;
    return this.send(tenantId, guardian, 'fee_reminder', text, `reminder:${s.studentId}:${today}`);
  }
}
