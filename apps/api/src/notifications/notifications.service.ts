import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type { AnnouncementPriority, ChannelsDto, NotificationDto, NotificationFeedDto } from '@sms/shared';
import type { AuthUser } from '../auth/auth-user';
import { SMS_SENDER, type SmsSender } from '../auth/sms';
import { devProvidersAllowed } from '../config/runtime';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_SENDER, type EmailSender } from './email';

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN')}`;
const FEED_SIZE = 50;

export interface Recipient {
  id: string;
  phone: string | null;
  email: string | null;
  active: boolean;
}

/**
 * Messages to parents and staff on three channels: SMS, e-mail and in-app (the feed behind the bell
 * on the website and the Notices tab in the app). Every message is recorded first under a dedupe key
 * (queued → sent / failed), so a retry, a double click or a repeated webhook never sends anything twice.
 * SMS goes through SMS_SENDER and e-mail through EMAIL_SENDER: consoles in development until providers are chosen.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Optional() @Inject(EMAIL_SENDER) private readonly mail: EmailSender | null,
  ) {}

  channels(): ChannelsDto {
    return { sms: true, email: !!this.mail, simulated: devProvidersAllowed() };
  }

  // ---------- channels ----------

  /** One SMS unless one with the same key was already recorded. Returns true if sent now. */
  async send(tenantId: string, user: { id: string; phone: string | null; active: boolean }, template: string, text: string, dedupeKey: string, announcementId?: string): Promise<boolean> {
    if (!user.phone || !user.active) return false;
    return this.deliver({ tenantId, userId: user.id, channel: 'sms', template, text, dedupeKey, announcementId }, () => this.sms.send(user.phone!, text));
  }

  /** One e-mail (when an e-mail provider is configured). */
  async sendEmail(tenantId: string, user: Recipient, template: string, subject: string, text: string, dedupeKey: string, announcementId?: string): Promise<boolean> {
    if (!this.mail || !user.email || !user.active) return false;
    return this.deliver({ tenantId, userId: user.id, channel: 'email', template, title: subject, text, dedupeKey, announcementId }, () => this.mail!.send(user.email!, subject, text));
  }

  /** One in-app notice in the user's feed. Nothing leaves the system, so it is "sent" at once. */
  async inApp(tenantId: string, userId: string, n: { template: string; title: string; text: string; link?: string | null; dedupeKey: string; announcementId?: string }): Promise<boolean> {
    const created = await this.prisma.notification.createMany({
      data: [{ tenantId, userId, channel: 'inapp', template: n.template, title: n.title, text: n.text, link: n.link ?? null, dedupeKey: n.dedupeKey, status: 'sent', sentAt: new Date(), announcementId: n.announcementId }],
      skipDuplicates: true,
    });
    return created.count > 0;
  }

  private async deliver(row: { tenantId: string; userId: string; channel: string; template: string; title?: string; text: string; dedupeKey: string; announcementId?: string }, go: () => Promise<void>): Promise<boolean> {
    const created = await this.prisma.notification.createMany({ data: [row], skipDuplicates: true });
    if (!created.count) return false;
    try {
      await go();
      await this.prisma.notification.update({ where: { dedupeKey: row.dedupeKey }, data: { status: 'sent', sentAt: new Date() } });
      return true;
    } catch (e) {
      this.log.warn(`${row.template} ${row.channel} to ${row.userId} failed: ${(e as Error).message}`);
      await this.prisma.notification.update({ where: { dedupeKey: row.dedupeKey }, data: { status: 'failed', error: (e as Error).message.slice(0, 300) } });
      return false;
    }
  }

  // ---------- events ----------

  /** "Payment received": SMS to the primary guardian, in-app notice to every guardian. Never throws. */
  async receiptIssued(receiptId: string): Promise<void> {
    try {
      const r = await this.prisma.feeReceipt.findUnique({
        where: { id: receiptId },
        include: { lines: true, branch: { select: { name: true } }, student: { select: { name: true, guardians: { include: { user: true } } } } },
      });
      if (!r) return;
      const what = r.lines.map((l) => l.label).join(', ');
      const text = `Received ${inr(r.total)} for ${r.student.name} towards ${what}. Receipt ${r.no}. Thank you - ${r.branch.name}.`;
      for (const g of r.student.guardians) {
        await this.inApp(r.tenantId, g.userId, { template: 'receipt', title: `Payment received: ${inr(r.total)}`, text, link: `/receipts/${r.id}`, dedupeKey: `receipt:${r.id}:${g.userId}:inapp` });
        if (g.primary) await this.send(r.tenantId, g.user, 'receipt', text, `receipt:${r.id}:${g.userId}`);
      }
    } catch (e) {
      this.log.warn(`Receipt notification for ${receiptId} failed: ${(e as Error).message}`);
    }
  }

  /** Absent today: SMS and in-app to the primary guardian (once per student per day). Returns true if the SMS went now. */
  async absence(tenantId: string, s: { id: string; name: string; className: string; branchName: string }, guardian: { id: string; phone: string | null; active: boolean }, date: string): Promise<boolean> {
    const text = `${s.name} (${s.className}) was marked absent at ${s.branchName} today, ${date}. If this is unexpected, please contact the school.`;
    await this.inApp(tenantId, guardian.id, { template: 'absence', title: `${s.name} was absent on ${date}`, text, link: '/attendance', dedupeKey: `absence:${s.id}:${date}:${guardian.id}:inapp` });
    return this.send(tenantId, guardian, 'absence', text, `absence:${s.id}:${date}:${guardian.id}`);
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
    await this.inApp(tenantId, guardian.id, { template: 'fee_reminder', title: `Fees overdue for ${s.studentName}: ${inr(s.overdue)}`, text, link: '/fees', dedupeKey: `reminder:${s.studentId}:${today}:inapp` });
    return this.send(tenantId, guardian, 'fee_reminder', text, `reminder:${s.studentId}:${today}`);
  }

  // ---------- the user's feed ----------

  /** Newest first, pinned announcements on top; withdrawn announcements are left out. */
  async feed(user: AuthUser): Promise<NotificationFeedDto> {
    const where = { userId: user.id, channel: 'inapp', OR: [{ announcementId: null }, { announcement: { withdrawnAt: null } }] };
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, include: { announcement: { select: { priority: true, pinned: true } } }, orderBy: { createdAt: 'desc' }, take: FEED_SIZE }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    const items: NotificationDto[] = rows.map((n) => ({
      id: n.id,
      kind: n.template,
      title: n.title ?? n.text.slice(0, 80),
      text: n.text,
      link: n.link,
      createdAt: n.createdAt.toISOString(),
      read: !!n.readAt,
      priority: (n.announcement?.priority as AnnouncementPriority | undefined) ?? null,
      pinned: !!n.announcement?.pinned,
    }));
    items.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return { items, unread };
  }

  async markRead(user: AuthUser, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId: user.id, channel: 'inapp' }, data: { readAt: new Date() } });
    if (!count) throw new NotFoundException('Notification not found');
  }

  async markAllRead(user: AuthUser): Promise<{ marked: number }> {
    const { count } = await this.prisma.notification.updateMany({ where: { userId: user.id, channel: 'inapp', readAt: null }, data: { readAt: new Date() } });
    return { marked: count };
  }
}
