import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import type { StaffAccess, StaffDto, StaffInput } from '@sms/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { isSchoolAdmin, ScopeService } from '../common/scope.service';
import { clean, emailOrNull, isoDate, optionalPhone, parseDate, sentKeys } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
const include = { branch: true, user: true, classTeacher: { select: { name: true } } } as const;
type StaffRow = Prisma.StaffGetPayload<{ include: typeof include }>;

const ROLE_FOR: Record<Exclude<StaffAccess, 'none'>, Role> = { teacher: 'teacher', accounts: 'accounts', manager: 'manager' };

export function toStaffDto(s: StaffRow): StaffDto {
  const access: StaffAccess = s.user?.active ? (s.user.role as StaffAccess) : 'none';
  return {
    id: s.id,
    branchId: s.branchId,
    branchName: s.branch.name,
    name: s.name,
    role: s.role,
    subject: s.subject,
    email: s.email,
    phone: s.phone,
    qualification: s.qualification,
    status: s.status === 'Inactive' ? 'Inactive' : 'Active',
    joinedOn: isoDate(s.joinedOn),
    access,
    classTeacherOf: s.classTeacher.map((c) => c.name),
  };
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, input: StaffInput, tx: Tx = this.prisma, opts: { audit?: boolean } = {}): Promise<StaffDto> {
    const b = await this.scope.branch(user, input.branchId);
    const access = input.access ?? 'none';
    this.assertMayGrant(user, access);
    const phone = optionalPhone(input.phone, 'mobile number');
    const email = emailOrNull(input.email);
    if (access !== 'none' && !phone) throw new BadRequestException('A mobile number is needed to give login access (staff sign in with a one-time code)');

    const staff = await tx.staff.create({
      data: {
        branchId: b.id,
        name: input.name.trim(),
        role: input.role.trim(),
        subject: clean(input.subject),
        email,
        phone,
        qualification: clean(input.qualification),
        joinedOn: parseDate(input.joinedOn),
        status: input.status ?? 'Active',
      },
    });
    if (access !== 'none') await this.grant(tx, staff.id, b.tenantId, b.id, access, { name: staff.name, title: `${staff.role} – ${b.name}`, phone: phone!, email });

    const row = await tx.staff.findUniqueOrThrow({ where: { id: staff.id }, include });
    if (opts.audit !== false) await this.audit.record({ tenantId: b.tenantId, actorId: user.id, action: 'staff.create', entity: 'Staff', entityId: staff.id, data: { name: staff.name, branch: b.code, access } });
    return toStaffDto(row);
  }

  async update(user: AuthUser, id: string, input: Partial<StaffInput>): Promise<StaffDto> {
    const s = await this.find(user, id);
    if (input.branchId && input.branchId !== s.branchId) throw new BadRequestException('Moving staff between branches is not supported yet');
    const current: StaffAccess = s.user?.active ? (s.user.role as StaffAccess) : 'none';
    const access = input.access ?? current;
    if (access !== current || current === 'manager') this.assertMayGrant(user, access === 'none' ? current : access);
    if (s.userId === user.id && (access !== current || input.status === 'Inactive')) throw new ForbiddenException('You cannot change your own access');

    const phone = input.phone === undefined ? s.phone : optionalPhone(input.phone, 'mobile number');
    const email = input.email === undefined ? s.email : emailOrNull(input.email);
    const status = input.status ?? s.status;
    const effective: StaffAccess = status === 'Inactive' ? 'none' : access;
    if (effective !== 'none' && !phone) throw new BadRequestException('A mobile number is needed to give login access');

    await this.prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          role: input.role?.trim(),
          subject: input.subject === undefined ? undefined : clean(input.subject),
          qualification: input.qualification === undefined ? undefined : clean(input.qualification),
          joinedOn: input.joinedOn === undefined ? undefined : parseDate(input.joinedOn),
          phone,
          email,
          status,
        },
      });
      const name = input.name?.trim() ?? s.name;
      const title = `${input.role?.trim() ?? s.role} – ${s.branch.name}`;
      if (effective === 'none') {
        if (s.userId) await this.revoke(tx, s.userId);
      } else {
        await this.grant(tx, id, s.branch.tenantId, s.branchId, effective, { name, title, phone: phone!, email });
      }
    });

    const row = await this.prisma.staff.findUniqueOrThrow({ where: { id }, include });
    await this.audit.record({
      tenantId: s.branch.tenantId,
      actorId: user.id,
      action: 'staff.update',
      entity: 'Staff',
      entityId: id,
      data: { name: row.name, changed: sentKeys(input), access: { before: current, after: effective } },
    });
    return toStaffDto(row);
  }

  async find(user: AuthUser, id: string): Promise<StaffRow> {
    const s = await this.prisma.staff.findUnique({ where: { id }, include });
    if (!s) throw new NotFoundException('Staff member not found');
    await this.scope.branch(user, s.branchId).catch(() => {
      throw new NotFoundException('Staff member not found');
    });
    return s;
  }

  /** Branch managers may give teacher/accounts logins; only the School Admin may create or change manager logins. */
  private assertMayGrant(user: AuthUser, access: StaffAccess): void {
    if (access === 'manager' && !isSchoolAdmin(user)) throw new ForbiddenException('Only the School Admin can give or change manager access');
  }

  /** Creates or updates the staff member's login. The mobile number must not already belong to someone else. */
  private async grant(tx: Tx, staffId: string, tenantId: string, branchId: string, access: Exclude<StaffAccess, 'none'>, p: { name: string; title: string; phone: string; email: string | null }) {
    const staff = await tx.staff.findUniqueOrThrow({ where: { id: staffId } });
    const clashPhone = await tx.user.findFirst({ where: { phone: p.phone, NOT: staff.userId ? { id: staff.userId } : undefined } });
    if (clashPhone) throw new ConflictException(clashPhone.tenantId === tenantId ? `Mobile ${p.phone} already has a login (${clashPhone.name})` : `Mobile ${p.phone} cannot be used`);
    if (p.email) {
      const clashEmail = await tx.user.findFirst({ where: { email: p.email, NOT: staff.userId ? { id: staff.userId } : undefined } });
      if (clashEmail) throw new ConflictException(clashEmail.tenantId === tenantId ? `E-mail ${p.email} already has a login (${clashEmail.name})` : `E-mail ${p.email} cannot be used`);
    }
    const data = { role: ROLE_FOR[access], name: p.name, title: p.title, phone: p.phone, email: p.email, tenantId, branchId, active: true };
    if (staff.userId) {
      const before = await tx.user.findUniqueOrThrow({ where: { id: staff.userId } });
      await tx.user.update({ where: { id: staff.userId }, data });
      // A role change must take effect now, not when the old access token expires.
      if (before.role !== data.role) await tx.refreshToken.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    } else {
      const u = await tx.user.create({ data });
      await tx.staff.update({ where: { id: staffId }, data: { userId: u.id } });
    }
  }

  /** Disables the login and ends its sessions. The account is kept for the audit trail. */
  private async revoke(tx: Tx, userId: string) {
    await tx.user.update({ where: { id: userId }, data: { active: false } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Thin wrapper for list queries so the controller stays small. */
  async list(user: AuthUser, q: { branchId?: string; search?: string; status?: string }): Promise<StaffDto[]> {
    const where: Prisma.StaffWhereInput = { ...(await this.scope.branchFilter(user, q.branchId)) };
    if (q.status) where.status = q.status;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }];
    const rows = await this.prisma.staff.findMany({ where, include, orderBy: [{ branchId: 'asc' }, { name: 'asc' }] });
    return rows.map(toStaffDto);
  }

  static isUniqueError(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
