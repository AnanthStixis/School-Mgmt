import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GuardianInput, Paged, StudentDto, StudentInput, StudentListItem, StudentStatus } from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { ScopeService } from '../common/scope.service';
import { clean, emailOrNull, isoDate, parseDate, phoneOrThrow, sentKeys } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

const listInclude = {
  branch: { select: { name: true } },
  class: { select: { name: true } },
  guardians: { include: { user: { select: { name: true, phone: true } } }, orderBy: { primary: 'desc' as const } },
} as const;

const detailInclude = {
  branch: { select: { name: true } },
  class: { select: { name: true } },
  guardians: { include: { user: true }, orderBy: { primary: 'desc' as const } },
} as const;

type ListRow = Prisma.StudentGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.StudentGetPayload<{ include: typeof detailInclude }>;

function toListItem(s: ListRow | DetailRow): StudentListItem {
  const g = s.guardians[0];
  return {
    id: s.id,
    admissionNo: s.admissionNo,
    name: s.name,
    gender: s.gender,
    branchId: s.branchId,
    branchName: s.branch.name,
    classId: s.classId,
    className: s.class?.name ?? null,
    rollNo: s.rollNo,
    status: s.status as StudentStatus,
    primaryGuardian: g ? { name: g.user.name, phone: g.user.phone } : null,
  };
}

export interface StudentQuery {
  branchId?: string;
  classId?: string;
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, query: StudentQuery): Promise<Paged<StudentListItem>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.StudentWhereInput = { ...(await this.scope.branchFilter(user, query.branchId)) };
    if (query.classId) where.classId = query.classId;
    if (query.status) where.status = query.status;
    const q = query.q?.trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { admissionNo: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ guardians: { some: { user: { phone: { contains: digits } } } } }] : []),
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        include: listInclude,
        orderBy: [{ class: { grade: 'asc' } }, { class: { name: 'asc' } }, { rollNo: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toListItem), total, page, pageSize };
  }

  async get(user: AuthUser, id: string): Promise<StudentDto> {
    const s = await this.findInScope(user, id);
    const guardianIds = s.guardians.map((g) => g.userId);
    const siblings = guardianIds.length
      ? await this.prisma.student.findMany({
          // Guardian logins belong to one tenant, so this cannot reach another school's students.
          where: { id: { not: s.id }, guardians: { some: { userId: { in: guardianIds } } } },
          include: { class: { select: { name: true } } },
        })
      : [];
    return {
      ...toListItem(s),
      dob: isoDate(s.dob),
      bloodGroup: s.bloodGroup,
      house: s.house,
      address: s.address,
      admittedOn: isoDate(s.admittedOn),
      guardians: s.guardians.map((g) => ({ userId: g.userId, name: g.user.name, phone: g.user.phone, email: g.user.email, relation: g.relation, primary: g.primary })),
      siblings: siblings.map((x) => ({ id: x.id, name: x.name, className: x.class?.name ?? null })),
    };
  }

  /** Creates a student with guardians. Pass `tx` to run inside a larger transaction (CSV import). */
  async create(user: AuthUser, input: StudentInput, tx?: Tx, opts: { audit?: boolean } = {}): Promise<{ id: string; admissionNo: string }> {
    const b = await this.scope.branch(user, input.branchId);
    const run = async (t: Tx) => {
      const classId = await this.checkClass(t, b.id, input.classId);
      const admissionNo = clean(input.admissionNo) ?? (await this.nextAdmissionNo(t, b.id, b.code));
      if (await t.student.findFirst({ where: { branchId: b.id, admissionNo } })) throw new ConflictException(`Admission number ${admissionNo} is already used in ${b.name}`);
      if (!input.guardians?.length) throw new BadRequestException('At least one guardian with a mobile number is required');

      const s = await t.student.create({
        data: {
          branchId: b.id,
          classId,
          admissionNo,
          name: input.name.trim(),
          gender: clean(input.gender),
          dob: parseDate(input.dob),
          rollNo: input.rollNo ?? null,
          bloodGroup: clean(input.bloodGroup),
          house: clean(input.house),
          address: clean(input.address),
          admittedOn: parseDate(input.admittedOn) ?? new Date(new Date().toISOString().slice(0, 10)),
          status: input.status ?? 'Active',
        },
      });
      await this.setGuardians(t, b.tenantId, b.id, s.id, input.guardians);
      return { id: s.id, admissionNo };
    };
    const result = tx ? await run(tx) : await this.prisma.$transaction(run);
    if (opts.audit !== false) await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'student.create', entity: 'Student', entityId: result.id, data: { admissionNo: result.admissionNo, branch: b.code } });
    return result;
  }

  async update(user: AuthUser, id: string, input: Partial<StudentInput>): Promise<StudentDto> {
    const s = await this.findInScope(user, id);
    if (input.branchId && input.branchId !== s.branchId) throw new BadRequestException('Moving a student to another branch is not supported yet');
    const tenantId = (await this.scope.branch(user, s.branchId)).tenantId;

    await this.prisma.$transaction(async (t) => {
      const admissionNo = input.admissionNo === undefined ? undefined : clean(input.admissionNo);
      if (admissionNo && admissionNo !== s.admissionNo && (await t.student.findFirst({ where: { branchId: s.branchId, admissionNo } }))) {
        throw new ConflictException(`Admission number ${admissionNo} is already used`);
      }
      await t.student.update({
        where: { id },
        data: {
          admissionNo: admissionNo ?? undefined,
          name: input.name?.trim(),
          classId: input.classId === undefined ? undefined : await this.checkClass(t, s.branchId, input.classId),
          gender: input.gender === undefined ? undefined : clean(input.gender),
          dob: input.dob === undefined ? undefined : parseDate(input.dob),
          rollNo: input.rollNo === undefined ? undefined : input.rollNo,
          bloodGroup: input.bloodGroup === undefined ? undefined : clean(input.bloodGroup),
          house: input.house === undefined ? undefined : clean(input.house),
          address: input.address === undefined ? undefined : clean(input.address),
          admittedOn: input.admittedOn === undefined ? undefined : parseDate(input.admittedOn),
          status: input.status,
        },
      });
      if (input.guardians) await this.setGuardians(t, tenantId, s.branchId, id, input.guardians);
    });
    await this.audit.record({
      tenantId,
      actorId: user.id,
      action: input.status && input.status !== s.status ? 'student.status_change' : 'student.update',
      entity: 'Student',
      entityId: id,
      data: { admissionNo: s.admissionNo, changed: sentKeys(input), ...(input.status && input.status !== s.status ? { from: s.status, to: input.status } : {}) },
    });
    return this.get(user, id);
  }

  private async findInScope(user: AuthUser, id: string): Promise<DetailRow> {
    const s = await this.prisma.student.findUnique({ where: { id }, include: detailInclude });
    if (!s) throw new NotFoundException('Student not found');
    await this.scope.branch(user, s.branchId).catch(() => {
      throw new NotFoundException('Student not found');
    });
    return s;
  }

  private async checkClass(t: Tx, branchId: string, classId: string | null | undefined): Promise<string | null> {
    if (!classId) return null;
    const c = await t.schoolClass.findFirst({ where: { id: classId, branchId } });
    if (!c) throw new BadRequestException('Class must belong to the student’s branch');
    return c.id;
  }

  /** <CODE><yy>-<0001>, e.g. BNMPS26-0042, where yy is the current academic year's start. */
  private async nextAdmissionNo(t: Tx, branchId: string, code: string): Promise<string> {
    const b = await t.branch.findUniqueOrThrow({ where: { id: branchId } });
    const year = await t.academicYear.findFirst({ where: { tenantId: b.tenantId, current: true } });
    const yy = (year?.label ?? String(new Date().getFullYear())).slice(2, 4);
    const prefix = `${code}${yy}-`;
    const last = await t.student.findFirst({ where: { branchId, admissionNo: { startsWith: prefix } }, orderBy: { admissionNo: 'desc' } });
    const n = last ? parseInt(last.admissionNo.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(4, '0')}`;
  }

  /**
   * Replaces the student's guardians. A guardian is identified by mobile number, so two
   * students with the same parent number share one parent login (siblings).
   */
  private async setGuardians(t: Tx, tenantId: string, branchId: string, studentId: string, guardians: GuardianInput[]) {
    if (!guardians.length) throw new BadRequestException('At least one guardian with a mobile number is required');
    if (guardians.length > 3) throw new BadRequestException('At most 3 guardians per student');
    const primaryIdx = Math.max(0, guardians.findIndex((g) => g.primary));
    const keep: string[] = [];

    for (const [i, g] of guardians.entries()) {
      const phone = phoneOrThrow(g.phone, `mobile number for ${g.name || 'guardian'}`);
      const name = g.name?.trim();
      if (!name) throw new BadRequestException('Guardian name is required');
      let u = await t.user.findUnique({ where: { phone } });
      if (u && u.tenantId !== tenantId) throw new ConflictException(`Mobile ${phone} cannot be used`);
      if (!u) {
        const email = emailOrNull(g.email);
        if (email && (await t.user.findUnique({ where: { email } }))) throw new ConflictException(`E-mail ${email} is already used by another account`);
        u = await t.user.create({ data: { tenantId, branchId, role: 'parent', name, title: 'Parent', phone, email } });
      }
      if (keep.includes(u.id)) throw new BadRequestException(`Mobile ${phone} is entered twice`);
      keep.push(u.id);
      await t.studentGuardian.upsert({
        where: { studentId_userId: { studentId, userId: u.id } },
        create: { studentId, userId: u.id, relation: g.relation || 'Parent', primary: i === primaryIdx },
        update: { relation: g.relation || 'Parent', primary: i === primaryIdx },
      });
    }
    await t.studentGuardian.deleteMany({ where: { studentId, userId: { notIn: keep } } });
  }
}
