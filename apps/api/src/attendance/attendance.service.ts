import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BranchSettings } from '@sms/shared';
import {
  type AttendanceOverview,
  type AttendanceStatus,
  type ClassAttendanceRow,
  type MarkableClass,
  type RegisterDto,
  type RegisterSaveInput,
  type RegisterSaveResult,
  type StudentAttendanceDto,
} from '@sms/shared';
import type { AcademicYear, Branch, SchoolClass } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { addDays, dayDate, dayString, todayIST, weekday } from '../common/dates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** Teachers may correct their class's register for this many days back; managers for the whole year. */
export const TEACHER_EDIT_DAYS = 2;
const DEFAULT_THRESHOLD = 75;
const ON_ROLL = ['Active', 'Temporary'];

type ClassWithBranch = SchoolClass & { branch: Branch; academicYear: AcademicYear; classTeacher: { userId: string | null } | null };

const pct = (p: number, total: number) => (total ? Math.round((p / total) * 1000) / 10 : null);

@Injectable()
export class AttendanceService {

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Classes the caller can take attendance for: managers all in scope, teachers the classes they teach as class teacher. */
  async markable(user: AuthUser): Promise<MarkableClass[]> {
    const year = await this.scope.year(user);
    const where = { ...(await this.scope.branchFilter(user)), academicYearId: year.id, ...(user.role === 'teacher' ? { classTeacher: { userId: user.id } } : {}) };
    const classes = await this.prisma.schoolClass.findMany({ where, include: { branch: true, classTeacher: { select: { userId: true } } }, orderBy: [{ branchId: 'asc' }, { grade: 'asc' }, { section: 'asc' }] });
    const today = dayDate(todayIST());
    const done = new Set((await this.prisma.attendanceRegister.findMany({ where: { classId: { in: classes.map((c) => c.id) }, date: today }, select: { classId: true } })).map((r) => r.classId));
    return classes.map((c) => ({ id: c.id, name: c.name, branchId: c.branchId, branchName: c.branch.name, isMyClass: c.classTeacher?.userId === user.id, submittedToday: done.has(c.id) }));
  }

  async register(user: AuthUser, classId: string, date = todayIST()): Promise<RegisterDto> {
    const c = await this.findClass(user, classId);
    const d = dayDate(date);
    const rules = this.editRules(user, c, date);
    const students = await this.prisma.student.findMany({ where: { classId, status: { in: ON_ROLL } }, orderBy: [{ rollNo: 'asc' }, { name: 'asc' }] });
    const marks = await this.prisma.attendanceRecord.findMany({ where: { date: d, studentId: { in: students.map((s) => s.id) } } });
    const reg = await this.prisma.attendanceRegister.findUnique({ where: { classId_date: { classId, date: d } } });
    const percents = await this.percents(students.map((s) => s.id), c.academicYear.startsOn, dayDate(todayIST()));
    return {
      classId,
      className: c.name,
      date,
      notWorkingDay: rules.notWorkingDay,
      submitted: reg ? { by: reg.submittedBy, at: reg.submittedAt.toISOString() } : null,
      canEdit: rules.canEdit,
      editNote: rules.note,
      entries: students.map((s) => ({
        studentId: s.id,
        name: s.name,
        admissionNo: s.admissionNo,
        rollNo: s.rollNo,
        status: (marks.find((m) => m.studentId === s.id)?.status as AttendanceStatus) ?? null,
        percent: percents.get(s.id) ?? null,
      })),
    };
  }

  /**
   * Saves a whole register for one class and day. Every student on the roll must be marked.
   * When the day is today, guardians of absent students get one SMS each (never twice for the same day).
   */
  async save(user: AuthUser, input: RegisterSaveInput): Promise<RegisterSaveResult> {
    const c = await this.findClass(user, input.classId);
    const rules = this.editRules(user, c, input.date);
    if (!rules.canEdit) throw new ForbiddenException(rules.note ?? 'You cannot change this register');
    const d = dayDate(input.date);

    const roll = await this.prisma.student.findMany({ where: { classId: c.id, status: { in: ON_ROLL } }, select: { id: true, name: true } });
    const rollIds = new Set(roll.map((s) => s.id));
    const given = new Map(input.entries.map((e) => [e.studentId, e.status]));
    const stranger = input.entries.find((e) => !rollIds.has(e.studentId));
    if (stranger) throw new BadRequestException('A student in the register is not on this class’s roll');
    const missing = roll.filter((s) => !given.has(s.id));
    if (missing.length) throw new BadRequestException(`Mark every student before submitting (${missing.length} left, e.g. ${missing[0].name})`);

    const by = (await this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }))?.name ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.deleteMany({ where: { date: d, studentId: { in: [...rollIds] } } });
      await tx.attendanceRecord.createMany({ data: roll.map((s) => ({ studentId: s.id, classId: c.id, date: d, status: given.get(s.id)!, markedById: user.id })) });
      await tx.attendanceRegister.upsert({
        where: { classId_date: { classId: c.id, date: d } },
        create: { classId: c.id, date: d, submittedById: user.id, submittedBy: by },
        update: { submittedById: user.id, submittedBy: by, submittedAt: new Date() },
      });
    });

    const counts = { P: 0, A: 0, L: 0 } as Record<AttendanceStatus, number>;
    for (const s of given.values()) counts[s]++;
    const absent = roll.filter((s) => given.get(s.id) === 'A');
    const alertsSent = input.date === todayIST() ? await this.alertAbsences(c, absent, input.date) : 0;

    await this.audit.record({
      tenantId: c.branch.tenantId,
      actorId: user.id,
      action: 'attendance.submit',
      entity: 'SchoolClass',
      entityId: c.id,
      data: { class: c.name, date: input.date, ...counts, alertsSent },
    });
    return { saved: roll.length, present: counts.P, absent: counts.A, leave: counts.L, alertsSent };
  }

  async overview(user: AuthUser, branchId?: string): Promise<AttendanceOverview> {
    const year = await this.scope.year(user);
    const filter = await this.scope.branchFilter(user, branchId);
    const today = todayIST();
    const from = dayString(year.startsOn);
    const classes = await this.prisma.schoolClass.findMany({
      where: { ...filter, academicYearId: year.id },
      include: { branch: true, _count: { select: { students: { where: { status: { in: ON_ROLL } } } } } },
      orderBy: [{ branchId: 'asc' }, { grade: 'asc' }, { section: 'asc' }],
    });
    const classIds = classes.map((c) => c.id);
    const period = { gte: year.startsOn, lte: dayDate(today) };

    const byClass = await this.prisma.attendanceRecord.groupBy({ by: ['classId', 'status'], where: { classId: { in: classIds }, date: period }, _count: true });
    const recentDays = await this.prisma.attendanceRegister.findMany({ where: { classId: { in: classIds }, date: { gte: dayDate(addDays(today, -21)), lte: dayDate(today) } }, select: { classId: true, date: true } });
    const recentRecs = await this.prisma.attendanceRecord.groupBy({ by: ['classId', 'date', 'status'], where: { classId: { in: classIds }, date: { gte: dayDate(addDays(today, -21)), lte: dayDate(today) } }, _count: true });
    const byStudent = await this.prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { classId: { in: classIds }, date: period }, _count: true });

    // Per-student % for the at-risk list (needs at least 5 marked days to avoid noise).
    const stu = new Map<string, { p: number; n: number }>();
    for (const r of byStudent) {
      const s = stu.get(r.studentId) ?? { p: 0, n: 0 };
      s.n += r._count;
      if (r.status === 'P') s.p += r._count;
      stu.set(r.studentId, s);
    }
    const onRoll = await this.prisma.student.findMany({ where: { classId: { in: classIds }, status: { in: ON_ROLL } }, select: { id: true, name: true, classId: true } });
    const threshold = (b: Branch) => (b.settings as BranchSettings | null)?.attendanceThreshold ?? DEFAULT_THRESHOLD;

    const rows: ClassAttendanceRow[] = classes.map((c) => {
      const recs = byClass.filter((r) => r.classId === c.id);
      const total = recs.reduce((n, r) => n + r._count, 0);
      const present = recs.find((r) => r.status === 'P')?._count ?? 0;
      const days = [...new Set(recentDays.filter((r) => r.classId === c.id).map((r) => dayString(r.date)))].sort().slice(-5);
      const recent = days.map((date) => {
        const rr = recentRecs.filter((r) => r.classId === c.id && dayString(r.date) === date);
        const n = rr.reduce((a, r) => a + r._count, 0);
        return { date, percent: pct(rr.find((r) => r.status === 'P')?._count ?? 0, n) ?? 0 };
      });
      const below = onRoll.filter((s) => s.classId === c.id).filter((s) => {
        const v = stu.get(s.id);
        return v && v.n >= 5 && (pct(v.p, v.n) ?? 100) < threshold(c.branch);
      }).length;
      return {
        classId: c.id,
        className: c.name,
        branchName: c.branch.name,
        strength: c._count.students,
        average: pct(present, total),
        recent,
        belowThreshold: below,
        submittedToday: recentDays.some((r) => r.classId === c.id && dayString(r.date) === today),
      };
    });

    const classById = new Map(classes.map((c) => [c.id, c]));
    const atRisk = onRoll
      .map((s) => {
        const v = stu.get(s.id);
        const c = classById.get(s.classId!)!;
        return v && v.n >= 5 ? { studentId: s.id, name: s.name, className: c.name, branchName: c.branch.name, percent: pct(v.p, v.n)!, threshold: threshold(c.branch) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.percent < x.threshold)
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 50);

    const todayRecs = recentRecs.filter((r) => dayString(r.date) === today);
    const todayTotal = todayRecs.reduce((n, r) => n + r._count, 0);
    const workingToday = classes.filter((c) => this.isWorkingDay(c.branch, today));
    return {
      date: today,
      from,
      classes: rows,
      atRisk,
      pendingToday: workingToday.filter((c) => c._count.students > 0 && !rows.find((r) => r.classId === c.id)?.submittedToday).length,
      todayPresentPercent: pct(todayRecs.find((r) => r.status === 'P')?._count ?? 0, todayTotal),
    };
  }

  /** One student's days. Staff see students in their scope; parents their own children; students themselves. */
  async student(user: AuthUser, studentId: string, from?: string, to?: string): Promise<StudentAttendanceDto> {
    const s = await this.prisma.student.findUnique({ where: { id: studentId }, include: { class: { include: { academicYear: true } }, branch: true, guardians: { select: { userId: true } } } });
    const notFound = new NotFoundException('Student not found');
    if (!s) throw notFound;
    if (user.role === 'parent') {
      if (!s.guardians.some((g) => g.userId === user.id)) throw notFound;
    } else if (user.role === 'student') {
      if (s.userId !== user.id) throw notFound;
    } else {
      await this.scope.branch(user, s.branchId).catch(() => {
        throw notFound;
      });
    }
    const end = to ?? todayIST();
    const start = from ?? (s.class ? dayString(s.class.academicYear.startsOn) : addDays(end, -60));
    const recs = await this.prisma.attendanceRecord.findMany({ where: { studentId, date: { gte: dayDate(start), lte: dayDate(end) } }, orderBy: { date: 'asc' } });
    const counts = { P: 0, A: 0, L: 0 } as Record<AttendanceStatus, number>;
    for (const r of recs) counts[r.status as AttendanceStatus]++;
    return {
      studentId,
      name: s.name,
      className: s.class?.name ?? null,
      from: start,
      to: end,
      threshold: (s.branch.settings as BranchSettings | null)?.attendanceThreshold ?? DEFAULT_THRESHOLD,
      percent: pct(counts.P, recs.length),
      counts,
      days: recs.map((r) => ({ date: dayString(r.date), status: r.status as AttendanceStatus })),
    };
  }

  /** The children a parent (or the student themself) can view, for the calendar's child switcher. */
  async myStudents(user: AuthUser): Promise<{ id: string; name: string; className: string | null }[]> {
    requireTenant(user);
    const where = user.role === 'parent' ? { guardians: { some: { userId: user.id } } } : user.role === 'student' ? { userId: user.id } : null;
    if (!where) return [];
    const rows = await this.prisma.student.findMany({ where, include: { class: { select: { name: true } } }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name, className: r.class?.name ?? null }));
  }

  // ---------- helpers ----------

  private async findClass(user: AuthUser, classId: string): Promise<ClassWithBranch> {
    const c = await this.prisma.schoolClass.findUnique({ where: { id: classId }, include: { branch: true, academicYear: true, classTeacher: { select: { userId: true } } } });
    if (!c) throw new NotFoundException('Class not found');
    await this.scope.branch(user, c.branchId).catch(() => {
      throw new NotFoundException('Class not found');
    });
    if (user.role === 'teacher' && c.classTeacher?.userId !== user.id) throw new ForbiddenException('Only the class teacher (or a manager) can take this class’s attendance');
    return c;
  }

  isWorkingDay(b: Branch, date: string): boolean {
    const days = (b.settings as BranchSettings | null)?.workingDays;
    return !days?.length || days.includes(weekday(date));
  }

  /** Whether the caller may change the register for this date, and why not. */
  editRules(user: AuthUser, c: ClassWithBranch, date: string): { canEdit: boolean; note: string | null; notWorkingDay: string | null } {
    const today = todayIST();
    const notWorkingDay = this.isWorkingDay(c.branch, date) ? null : `${weekday(date)} is not a working day for ${c.branch.name}`;
    const no = (note: string) => ({ canEdit: false, note, notWorkingDay });
    if (date > today) return no('Attendance cannot be marked for a future date');
    if (notWorkingDay) return no(notWorkingDay);
    if (c.academicYear.locked) return no(`Academic year ${c.academicYear.label} is locked`);
    const d = dayDate(date);
    if (d < c.academicYear.startsOn || d > c.academicYear.endsOn) return no(`The date is outside academic year ${c.academicYear.label}`);
    if (user.role === 'teacher' && date < addDays(today, -TEACHER_EDIT_DAYS)) return no(`Teachers can change attendance up to ${TEACHER_EDIT_DAYS} days back; ask a manager for older dates`);
    return { canEdit: true, note: null, notWorkingDay };
  }

  /** % present per student over [from, to]. */
  private async percents(studentIds: string[], from: Date, to: Date): Promise<Map<string, number>> {
    if (!studentIds.length) return new Map();
    const g = await this.prisma.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { studentId: { in: studentIds }, date: { gte: from, lte: to } }, _count: true });
    const acc = new Map<string, { p: number; n: number }>();
    for (const r of g) {
      const a = acc.get(r.studentId) ?? { p: 0, n: 0 };
      a.n += r._count;
      if (r.status === 'P') a.p += r._count;
      acc.set(r.studentId, a);
    }
    return new Map([...acc].map(([k, v]) => [k, pct(v.p, v.n)!]));
  }

  /**
   * One SMS (and an in-app notice) per primary guardian per absent student per day. The dedupe key
   * makes a re-submitted register (or a correction) never alert the same parent twice.
   */
  private async alertAbsences(c: ClassWithBranch, absent: { id: string; name: string }[], date: string): Promise<number> {
    if (!absent.length) return 0;
    const links = await this.prisma.studentGuardian.findMany({ where: { studentId: { in: absent.map((a) => a.id) }, primary: true }, include: { user: true } });
    let sent = 0;
    for (const l of links) {
      const student = absent.find((a) => a.id === l.studentId)!;
      if (await this.notifications.absence(c.branch.tenantId, { id: l.studentId, name: student.name, className: c.name, branchName: c.branch.name }, l.user, date)) sent++;
    }
    return sent;
  }
}
