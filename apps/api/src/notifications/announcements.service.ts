import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement } from '@prisma/client';
import {
  ANNOUNCEMENT_SMS_MAX,
  AUDIENCE_LABEL,
  type AnnouncementAudience,
  type AnnouncementDto,
  type AnnouncementInput,
  type AnnouncementPriority,
  type AudiencePreview,
} from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { requireTenant } from '../common/scope';
import { isSchoolAdmin, ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, type Recipient } from './notifications.service';

const STAFF_ROLES = ['manager', 'teacher', 'accounts'] as const;
const CURRENT = ['Active', 'Temporary'];

export type AudienceInput = Pick<AnnouncementInput, 'branchId' | 'audience' | 'classIds' | 'sms' | 'email'>;

interface Audience {
  tenantId: string;
  branchId: string | null;
  branchName: string | null;
  classes: { id: string; name: string }[];
  /** In-app for every guardian and student login; SMS only to primary guardians. */
  parents: (Recipient & { primary: boolean })[];
  students: Recipient[];
  staff: Recipient[];
}

/**
 * Announcements (circulars). Managers write to all parents, parents of chosen classes, staff, or
 * everyone, in their branch (the School Admin also to every branch); class teachers write to the
 * parents of their own class. Everyone in the audience gets an in-app notice; SMS and e-mail copies
 * are optional. An announcement can be withdrawn, which removes it from everyone's feed.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async preview(user: AuthUser, input: AudienceInput): Promise<AudiencePreview> {
    const a = await this.audience(user, input);
    const all = this.unique(a);
    return {
      recipients: all.length,
      parents: new Set(a.parents.map((p) => p.id)).size,
      students: a.students.length,
      staff: a.staff.length,
      sms: input.sms ? this.smsTargets(a).length : 0,
      email: input.email && this.notifications.channels().email ? all.filter((u) => u.email).length : 0,
    };
  }

  async create(user: AuthUser, input: AnnouncementInput): Promise<AnnouncementDto> {
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length < 3) throw new BadRequestException('Give the announcement a title');
    if (!body) throw new BadRequestException('Write the announcement');
    if (input.email && !this.notifications.channels().email) throw new BadRequestException('E-mail is not set up on this system yet');
    const a = await this.audience(user, input);
    const all = this.unique(a);
    if (!all.length) throw new BadRequestException('Nobody is in this audience yet');
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true } });

    const ann = await this.prisma.announcement.create({
      data: {
        tenantId: a.tenantId,
        branchId: a.branchId,
        title,
        body,
        audience: input.audience,
        classIds: input.audience === 'CLASSES' ? a.classes.map((c) => c.id) : undefined,
        priority: input.priority,
        pinned: input.pinned,
        sms: input.sms,
        email: input.email,
        recipients: all.length,
        createdById: user.id,
        createdByName: actor.name,
      },
    });

    // In-app for everyone, then the optional copies. (With a real SMS provider this loop belongs in a background job.)
    for (const u of all) await this.notifications.inApp(a.tenantId, u.id, { template: 'announcement', title, text: body, link: '/communication', dedupeKey: `ann:${ann.id}:${u.id}:inapp`, announcementId: ann.id });
    let smsSent = 0;
    let emailSent = 0;
    if (input.sms) {
      const text = smsText(a.branchName ?? 'BNM', title, body);
      for (const u of this.smsTargets(a)) if (await this.notifications.send(a.tenantId, u, 'announcement', text, `ann:${ann.id}:${u.id}:sms`, ann.id)) smsSent++;
    }
    if (input.email) {
      for (const u of all) if (await this.notifications.sendEmail(a.tenantId, u, 'announcement', title, `${body}\n\n— ${actor.name}, ${a.branchName ?? 'BNM'}`, `ann:${ann.id}:${u.id}:email`, ann.id)) emailSent++;
    }
    const saved = await this.prisma.announcement.update({ where: { id: ann.id }, data: { smsSent, emailSent } });
    await this.audit.record({ tenantId: a.tenantId, actorId: user.id, action: 'announcement.send', entity: 'Announcement', entityId: ann.id, data: { title, audience: input.audience, recipients: all.length, smsSent, emailSent } });
    return this.toDto(saved);
  }

  /** Staff who can write: what they (or their branch) sent. Everyone else: what they received. Pinned first. */
  async list(user: AuthUser): Promise<AnnouncementDto[]> {
    const tenantId = requireTenant(user);
    let rows: Announcement[];
    if (user.role === 'manager' || user.role === 'teacher') {
      rows = await this.prisma.announcement.findMany({
        where: {
          tenantId,
          ...(user.role === 'teacher' ? { createdById: user.id } : user.branchId ? { OR: [{ branchId: user.branchId }, { branchId: null }] } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } else {
      rows = await this.prisma.announcement.findMany({
        where: { tenantId, withdrawnAt: null, notifications: { some: { userId: user.id, channel: 'inapp' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }
    const dtos = await Promise.all(rows.map((r) => this.toDto(r)));
    return dtos.sort((a, b) => Number(b.pinned && !b.withdrawnAt) - Number(a.pinned && !a.withdrawnAt));
  }

  /** Takes an announcement back: it disappears from every feed (SMS and e-mails already sent can't be recalled). */
  async withdraw(user: AuthUser, id: string): Promise<AnnouncementDto> {
    const tenantId = requireTenant(user);
    const ann = await this.prisma.announcement.findFirst({ where: { id, tenantId } });
    if (!ann) throw new NotFoundException('Announcement not found');
    const mayManage = ann.createdById === user.id || (user.role === 'manager' && (isSchoolAdmin(user) || ann.branchId === user.branchId));
    if (!mayManage) throw new ForbiddenException('Only the sender or a manager of that branch can withdraw it');
    if (ann.withdrawnAt) throw new BadRequestException('Already withdrawn');
    const saved = await this.prisma.announcement.update({ where: { id }, data: { withdrawnAt: new Date(), pinned: false } });
    await this.audit.record({ tenantId, actorId: user.id, action: 'announcement.withdraw', entity: 'Announcement', entityId: id, data: { title: ann.title } });
    return this.toDto(saved);
  }

  // ---------- helpers ----------

  /** Who can write to whom, and who that is. */
  private async audience(user: AuthUser, input: AudienceInput): Promise<Audience> {
    const tenantId = requireTenant(user);
    if (user.role !== 'manager' && user.role !== 'teacher') throw new ForbiddenException('Only managers and class teachers can send announcements');
    if (user.role === 'teacher' && input.audience !== 'CLASSES') throw new ForbiddenException('Class teachers can write to the parents of their own class');

    // Branch: the School Admin may write to every branch (null); everyone else to their own branch.
    let branchId = input.branchId;
    if (!branchId && !isSchoolAdmin(user)) branchId = user.branchId;
    const branch = branchId ? await this.scope.branch(user, branchId) : null;

    let classes: { id: string; name: string }[] = [];
    if (input.audience === 'CLASSES') {
      const ids = [...new Set(input.classIds ?? [])];
      if (!ids.length) throw new BadRequestException('Choose at least one class');
      const year = await this.scope.year(user);
      const found = await this.prisma.schoolClass.findMany({
        where: { id: { in: ids }, academicYearId: year.id, branch: { tenantId }, ...(branch ? { branchId: branch.id } : user.branchId ? { branchId: user.branchId } : {}) },
        include: { classTeacher: { select: { userId: true } } },
        orderBy: [{ grade: 'asc' }, { section: 'asc' }],
      });
      if (found.length !== ids.length) throw new NotFoundException('Class not found');
      if (user.role === 'teacher' && found.some((c) => c.classTeacher?.userId !== user.id)) throw new ForbiddenException('You can only write to the parents of classes where you are the class teacher');
      classes = found.map((c) => ({ id: c.id, name: c.name }));
    }

    const branchFilter = branch ? { branchId: branch.id } : { branch: { tenantId } };
    const wantParents = input.audience !== 'STAFF';
    const wantStaff = input.audience === 'STAFF' || input.audience === 'EVERYONE';
    const students = wantParents
      ? await this.prisma.student.findMany({
          where: { ...branchFilter, status: { in: CURRENT }, ...(input.audience === 'CLASSES' ? { classId: { in: classes.map((c) => c.id) } } : {}) },
          select: { user: { select: { id: true, phone: true, email: true, active: true } }, guardians: { select: { primary: true, user: { select: { id: true, phone: true, email: true, active: true } } } } },
        })
      : [];
    const staff = wantStaff
      ? await this.prisma.user.findMany({
          where: { tenantId, role: { in: [...STAFF_ROLES] }, active: true, ...(branch ? { OR: [{ branchId: branch.id }, { branchId: null }] } : {}) },
          select: { id: true, phone: true, email: true, active: true },
        })
      : [];
    return {
      tenantId,
      branchId: branch?.id ?? null,
      branchName: branch?.name ?? null,
      classes,
      parents: students.flatMap((s) => s.guardians.filter((g) => g.user.active).map((g) => ({ ...g.user, primary: g.primary }))),
      students: students.map((s) => s.user).filter((u): u is Recipient => !!u?.active),
      staff: staff.filter((u) => u.id !== user.id),
    };
  }

  private unique(a: Audience): Recipient[] {
    const m = new Map<string, Recipient>();
    for (const u of [...a.parents, ...a.students, ...a.staff]) m.set(u.id, u);
    return [...m.values()];
  }

  /** SMS goes to primary guardians and staff (students have no phone of their own). */
  private smsTargets(a: Audience): Recipient[] {
    const m = new Map<string, Recipient>();
    for (const u of [...a.parents.filter((p) => p.primary), ...a.staff]) if (u.phone) m.set(u.id, u);
    return [...m.values()];
  }

  private async toDto(r: Announcement): Promise<AnnouncementDto> {
    const [branch, classes, read] = await Promise.all([
      r.branchId ? this.prisma.branch.findUnique({ where: { id: r.branchId }, select: { name: true } }) : null,
      r.classIds ? this.prisma.schoolClass.findMany({ where: { id: { in: r.classIds as string[] } }, select: { name: true }, orderBy: [{ grade: 'asc' }, { section: 'asc' }] }) : [],
      this.prisma.notification.count({ where: { announcementId: r.id, channel: 'inapp', readAt: { not: null } } }),
    ]);
    const audience = r.audience as AnnouncementAudience;
    const who = audience === 'CLASSES' ? `Parents of ${classes.map((c) => c.name).join(', ')}` : AUDIENCE_LABEL[audience];
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      audience,
      audienceLabel: `${who} · ${branch?.name ?? 'All branches'}`,
      branchName: branch?.name ?? null,
      priority: r.priority as AnnouncementPriority,
      pinned: r.pinned,
      sms: r.sms,
      email: r.email,
      recipients: r.recipients,
      smsSent: r.smsSent,
      emailSent: r.emailSent,
      read,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
    };
  }
}

/** "BNM Public School: Sports Day - Sports day is on 5 Dec…" cut to the SMS limit, pointing to the app for the rest. */
export function smsText(from: string, title: string, body: string): string {
  const full = `${from}: ${title} - ${body.replace(/\s+/g, ' ').trim()}`;
  if (full.length <= ANNOUNCEMENT_SMS_MAX) return full;
  const more = '… Read more in the parent app.';
  return full.slice(0, ANNOUNCEMENT_SMS_MAX - more.length).trimEnd() + more;
}

