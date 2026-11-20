import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ENQUIRY_STAGES,
  type AdmissionStats,
  type EnquiryDetailDto,
  type EnquiryDto,
  type EnquiryInput,
  type EnquiryStage,
  type EnrolInput,
  type PipelineStage,
} from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { clean, emailOrNull, isoDate, optionalPhone, parseDate, phoneOrThrow, sentKeys } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { StudentsService } from '../students/students.service';

const include = {
  branch: { select: { name: true } },
  academicYear: { select: { label: true } },
  student: { select: { id: true, admissionNo: true } },
} as const;
type Row = Prisma.EnquiryGetPayload<{ include: typeof include }>;

const OPEN: EnquiryStage[] = [...ENQUIRY_STAGES];

export interface EnquiryQuery {
  branchId?: string;
  academicYearId?: string;
  stage?: string;
  q?: string;
  includeClosed?: boolean;
}

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
  ) {}

  async list(user: AuthUser, query: EnquiryQuery): Promise<EnquiryDto[]> {
    const where = await this.where(user, query);
    if (query.stage) where.stage = query.stage;
    else if (!query.includeClosed) where.stage = { not: 'Dropped' };
    const q = query.q?.trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      where.OR = [{ childName: { contains: q, mode: 'insensitive' } }, { parentName: { contains: q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ parentPhone: { contains: digits } }] : [])];
    }
    const rows = await this.prisma.enquiry.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 500 });
    const dupes = await this.duplicates(rows);
    return rows.map((r) => this.toDto(r, dupes.get(r.id) ?? null));
  }

  async stats(user: AuthUser, query: EnquiryQuery): Promise<AdmissionStats> {
    const where = await this.where(user, query);
    const rows = await this.prisma.enquiry.findMany({ where, select: { stage: true, source: true, nextFollowUp: true } });
    const byStage = { Enquiry: 0, Applied: 0, 'Test/Interview': 0, Admitted: 0, Enrolled: 0, Dropped: 0 } as Record<EnquiryStage, number>;
    const sources = new Map<string, { total: number; converted: number }>();
    const today = new Date(new Date().toISOString().slice(0, 10));
    let followUpsDue = 0;
    for (const r of rows) {
      byStage[r.stage as EnquiryStage] = (byStage[r.stage as EnquiryStage] ?? 0) + 1;
      const s = sources.get(r.source) ?? { total: 0, converted: 0 };
      s.total++;
      if (r.stage === 'Admitted' || r.stage === 'Enrolled') s.converted++;
      sources.set(r.source, s);
      if (r.nextFollowUp && r.nextFollowUp <= today && OPEN.includes(r.stage as EnquiryStage)) followUpsDue++;
    }
    const admittedOrEnrolled = byStage.Admitted + byStage.Enrolled;
    return {
      total: rows.length,
      open: OPEN.reduce((n, s) => n + byStage[s], 0),
      admittedOrEnrolled,
      dropped: byStage.Dropped,
      conversion: rows.length ? Math.round((admittedOrEnrolled / rows.length) * 100) : 0,
      byStage,
      bySource: [...sources.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.total - a.total),
      followUpsDue,
    };
  }

  async get(user: AuthUser, id: string): Promise<EnquiryDetailDto> {
    const e = await this.find(user, id);
    const activity = await this.prisma.enquiryActivity.findMany({ where: { enquiryId: id }, orderBy: { at: 'desc' } });
    const dupes = await this.duplicates([e]);
    return {
      ...this.toDto(e, dupes.get(e.id) ?? null),
      activity: activity.map((a) => ({ id: a.id, kind: a.kind as EnquiryDetailDto['activity'][number]['kind'], text: a.text, byName: a.byName, at: a.at.toISOString() })),
    };
  }

  async create(user: AuthUser, input: EnquiryInput): Promise<EnquiryDetailDto> {
    const b = await this.scope.branch(user, input.branchId);
    const year = await this.scope.year(user, input.academicYearId);
    this.scope.assertYearOpen(year);
    const by = await this.actor(user);
    const e = await this.prisma.enquiry.create({
      data: {
        tenantId: b.tenantId,
        branchId: b.id,
        academicYearId: year.id,
        ...this.fields(input),
        childName: input.childName.trim(),
        parentName: input.parentName.trim(),
        parentPhone: phoneOrThrow(input.parentPhone, 'parent mobile'),
        grade: input.grade,
        createdById: user.id,
        activity: { create: { kind: 'created', text: `Enquiry recorded (source: ${input.source ?? 'Walk-in'})`, byId: user.id, byName: by } },
      },
    });
    await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'enquiry.create', entity: 'Enquiry', entityId: e.id, data: { child: e.childName, branch: b.code } });
    return this.get(user, e.id);
  }

  async update(user: AuthUser, id: string, input: Partial<EnquiryInput>): Promise<EnquiryDetailDto> {
    const e = await this.find(user, id);
    if (e.stage === 'Enrolled') throw new ConflictException('This child is already enrolled; edit the student record instead');
    if (input.branchId && input.branchId !== e.branchId) await this.scope.branch(user, input.branchId);
    if (input.academicYearId && input.academicYearId !== e.academicYearId) this.scope.assertYearOpen(await this.scope.year(user, input.academicYearId));
    await this.prisma.enquiry.update({
      where: { id },
      data: {
        ...this.fields(input),
        branchId: input.branchId,
        academicYearId: input.academicYearId,
        childName: input.childName?.trim(),
        parentName: input.parentName?.trim(),
        parentPhone: input.parentPhone === undefined ? undefined : phoneOrThrow(input.parentPhone, 'parent mobile'),
        grade: input.grade,
      },
    });
    await this.audit.record({ tenantId: e.tenantId, actorId: user.id, action: 'enquiry.update', entity: 'Enquiry', entityId: id, data: { changed: sentKeys(input) } });
    return this.get(user, id);
  }

  /** Moves an enquiry to any pipeline stage (forwards or back), or re-opens a dropped one. */
  async move(user: AuthUser, id: string, stage: PipelineStage): Promise<EnquiryDetailDto> {
    const e = await this.find(user, id);
    if (e.stage === 'Enrolled') throw new ConflictException('An enrolled enquiry cannot change stage');
    if (e.stage === stage) return this.get(user, id);
    const by = await this.actor(user);
    const text = e.stage === 'Dropped' ? `Re-opened at ${stage}` : `${e.stage} → ${stage}`;
    await this.prisma.enquiry.update({
      where: { id },
      data: { stage, dropReason: null, activity: { create: { kind: 'stage', text, byId: user.id, byName: by } } },
    });
    await this.audit.record({ tenantId: e.tenantId, actorId: user.id, action: 'enquiry.stage', entity: 'Enquiry', entityId: id, data: { from: e.stage, to: stage } });
    return this.get(user, id);
  }

  async drop(user: AuthUser, id: string, reason: string): Promise<EnquiryDetailDto> {
    const e = await this.find(user, id);
    if (e.stage === 'Enrolled') throw new ConflictException('An enrolled enquiry cannot be dropped; change the student’s status instead');
    const by = await this.actor(user);
    await this.prisma.enquiry.update({
      where: { id },
      data: { stage: 'Dropped', dropReason: reason.trim(), activity: { create: { kind: 'stage', text: `Dropped: ${reason.trim()}`, byId: user.id, byName: by } } },
    });
    await this.audit.record({ tenantId: e.tenantId, actorId: user.id, action: 'enquiry.drop', entity: 'Enquiry', entityId: id, data: { from: e.stage, reason } });
    return this.get(user, id);
  }

  async note(user: AuthUser, id: string, text: string, nextFollowUp?: string | null): Promise<EnquiryDetailDto> {
    await this.find(user, id);
    const by = await this.actor(user);
    await this.prisma.enquiry.update({
      where: { id },
      data: {
        nextFollowUp: nextFollowUp === undefined ? undefined : parseDate(nextFollowUp),
        activity: { create: { kind: 'note', text: text.trim(), byId: user.id, byName: by } },
      },
    });
    return this.get(user, id);
  }

  /**
   * Turns an admitted enquiry into a student (in one transaction). The parent mobile becomes the
   * guardian login, so a family already at the school is linked automatically as siblings.
   * Fee invoices for the new student are added by the fees module (sprint 4).
   */
  async enrol(user: AuthUser, id: string, input: EnrolInput): Promise<EnquiryDetailDto> {
    const e = await this.find(user, id);
    if (e.stage !== 'Admitted') throw new ConflictException(`Only admitted children can be enrolled (this one is at ${e.stage})`);
    if (input.classId) {
      const c = await this.prisma.schoolClass.findFirst({ where: { id: input.classId, branchId: e.branchId, academicYearId: e.academicYearId } });
      if (!c) throw new BadRequestException(`Class must be one of ${e.branch.name}'s classes for ${e.academicYear.label}`);
    }
    const by = await this.actor(user);
    const student = await this.prisma.$transaction(async (tx) => {
      const s = await this.students.create(
        user,
        {
          branchId: e.branchId,
          admissionNo: input.admissionNo ?? null,
          name: e.childName,
          gender: e.gender,
          dob: isoDate(e.dob),
          classId: input.classId ?? null,
          rollNo: input.rollNo ?? null,
          address: e.address,
          status: input.status ?? 'Active',
          guardians: [{ name: e.parentName, phone: e.parentPhone, email: e.parentEmail, relation: input.guardianRelation ?? 'Father', primary: true }],
        },
        tx,
        { audit: false },
      );
      // Guard against a double click enrolling twice: only one update can move Admitted → Enrolled.
      const { count } = await tx.enquiry.updateMany({ where: { id, stage: 'Admitted' }, data: { stage: 'Enrolled', studentId: s.id } });
      if (count !== 1) throw new ConflictException('This enquiry was just enrolled by someone else');
      await tx.enquiryActivity.create({ data: { enquiryId: id, kind: 'enrolled', text: `Enrolled as ${s.admissionNo}`, byId: user.id, byName: by } });
      return s;
    });
    await this.audit.record({ tenantId: e.tenantId, actorId: user.id, action: 'enquiry.enrol', entity: 'Enquiry', entityId: id, data: { studentId: student.id, admissionNo: student.admissionNo } });
    await this.audit.record({ tenantId: e.tenantId, actorId: user.id, action: 'student.create', entity: 'Student', entityId: student.id, data: { admissionNo: student.admissionNo, via: 'admissions' } });
    return this.get(user, id);
  }

  // ---------- helpers ----------

  private async where(user: AuthUser, q: EnquiryQuery): Promise<Prisma.EnquiryWhereInput> {
    const tenantId = requireTenant(user);
    const branch = await this.scope.branchFilter(user, q.branchId);
    const where: Prisma.EnquiryWhereInput = { tenantId, ...(branch.branchId ? { branchId: branch.branchId } : {}) };
    if (q.academicYearId) where.academicYearId = q.academicYearId;
    return where;
  }

  private async find(user: AuthUser, id: string): Promise<Row> {
    const e = await this.prisma.enquiry.findUnique({ where: { id }, include });
    if (!e) throw new NotFoundException('Enquiry not found');
    await this.scope.branch(user, e.branchId).catch(() => {
      throw new NotFoundException('Enquiry not found');
    });
    return e;
  }

  private async actor(user: AuthUser): Promise<string | null> {
    return (await this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }))?.name ?? null;
  }

  private fields(i: Partial<EnquiryInput>) {
    return {
      gender: i.gender === undefined ? undefined : clean(i.gender),
      dob: i.dob === undefined ? undefined : parseDate(i.dob),
      altPhone: i.altPhone === undefined ? undefined : optionalPhone(i.altPhone, 'alternate mobile'),
      parentEmail: i.parentEmail === undefined ? undefined : emailOrNull(i.parentEmail),
      city: i.city === undefined ? undefined : clean(i.city),
      address: i.address === undefined ? undefined : clean(i.address),
      previousSchool: i.previousSchool === undefined ? undefined : clean(i.previousSchool),
      previousBoard: i.previousBoard === undefined ? undefined : clean(i.previousBoard),
      siblingInSchool: i.siblingInSchool,
      source: i.source,
      nextFollowUp: i.nextFollowUp === undefined ? undefined : parseDate(i.nextFollowUp),
    };
  }

  /** Flags open enquiries that share a parent mobile and child name with an earlier open one. */
  private async duplicates(rows: Row[]): Promise<Map<string, string>> {
    const phones = [...new Set(rows.map((r) => r.parentPhone))];
    if (!phones.length) return new Map();
    const all = await this.prisma.enquiry.findMany({
      where: { parentPhone: { in: phones }, stage: { notIn: ['Dropped'] } },
      select: { id: true, parentPhone: true, childName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const first = new Map<string, string>();
    const out = new Map<string, string>();
    for (const e of all) {
      const key = `${e.parentPhone}|${e.childName.trim().toLowerCase()}`;
      const f = first.get(key);
      if (f) out.set(e.id, f);
      else first.set(key, e.id);
    }
    return out;
  }

  private toDto(e: Row, possibleDuplicateOf: string | null): EnquiryDto {
    return {
      id: e.id,
      branchId: e.branchId,
      branchName: e.branch.name,
      academicYearId: e.academicYearId,
      academicYear: e.academicYear.label,
      childName: e.childName,
      gender: e.gender,
      dob: isoDate(e.dob),
      grade: e.grade,
      parentName: e.parentName,
      parentPhone: e.parentPhone,
      altPhone: e.altPhone,
      parentEmail: e.parentEmail,
      city: e.city,
      address: e.address,
      previousSchool: e.previousSchool,
      previousBoard: e.previousBoard,
      siblingInSchool: e.siblingInSchool,
      source: e.source,
      stage: e.stage as EnquiryStage,
      dropReason: e.dropReason,
      nextFollowUp: isoDate(e.nextFollowUp),
      student: e.student,
      createdAt: e.createdAt.toISOString(),
      possibleDuplicateOf,
    };
  }
}
