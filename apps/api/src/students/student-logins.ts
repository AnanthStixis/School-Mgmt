import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, Put } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { STUDENT_PASSWORD_MIN, type SetStudentPasswordRequest, type StudentLoginStatus } from '@sms/shared';
import { IsString, Length } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';

/** bcrypt only uses the first 72 bytes, so longer passwords are refused rather than silently cut. */
const PASSWORD_MAX = 72;
const CURRENT_STATUSES = ['Active', 'Temporary'];

const studentInclude = {
  class: { select: { name: true } },
  branch: { select: { code: true, tenantId: true } },
  guardians: { select: { userId: true } },
  user: { select: { id: true, username: true, active: true, lastLoginAt: true, passwordHash: true } },
} satisfies Prisma.StudentInclude;
type StudentWithLogin = Prisma.StudentGetPayload<{ include: typeof studentInclude }>;

class SetPasswordDto implements SetStudentPasswordRequest {
  @IsString()
  @Length(STUDENT_PASSWORD_MIN, PASSWORD_MAX, { message: `Password must be ${STUDENT_PASSWORD_MIN} to ${PASSWORD_MAX} characters` })
  password!: string;
}

/**
 * Student sign-in accounts. A student has no phone of their own, so a parent (for their own children)
 * or a manager (for students in their scope) sets a password; the student signs in with their
 * admission number as login ID. Under the DPDP Act students are children, so the parent stays in control.
 */
@Injectable()
export class StudentLoginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** A parent's children, with each one's sign-in status. */
  async mine(user: AuthUser): Promise<StudentLoginStatus[]> {
    requireTenant(user);
    if (user.role !== 'parent') return [];
    const rows = await this.prisma.student.findMany({
      where: { guardians: { some: { userId: user.id } }, status: { in: CURRENT_STATUSES } },
      include: studentInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map(toStatus);
  }

  async get(user: AuthUser, studentId: string): Promise<StudentLoginStatus> {
    return toStatus(await this.find(user, studentId));
  }

  /** Sets (or resets) the password, creating the sign-in on first use. Ends the student's other sessions. */
  async setPassword(user: AuthUser, studentId: string, password: string): Promise<StudentLoginStatus> {
    const s = await this.find(user, studentId);
    if (!CURRENT_STATUSES.includes(s.status)) throw new BadRequestException(`Only current students can sign in (this student is ${s.status})`);
    const loginId = s.user?.username ?? (await this.allocateLoginId(s));
    if (password.trim().toUpperCase() === loginId) throw new BadRequestException('The password cannot be the same as the login ID');

    const passwordHash = await AuthService.hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      if (s.user) {
        await tx.user.update({ where: { id: s.user.id }, data: { passwordHash, username: loginId, active: true } });
        await tx.refreshToken.updateMany({ where: { userId: s.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      } else {
        const u = await tx.user.create({
          data: {
            tenantId: s.branch.tenantId,
            branchId: s.branchId,
            role: 'student',
            name: s.name,
            title: s.class ? `Class ${s.class.name}` : 'Student',
            username: loginId,
            passwordHash,
          },
        });
        await tx.student.update({ where: { id: s.id }, data: { userId: u.id } });
      }
    });
    await this.audit.record({
      tenantId: s.branch.tenantId,
      actorId: user.id,
      action: s.user?.passwordHash ? 'student.login_reset' : 'student.login_set',
      entity: 'Student',
      entityId: s.id,
      data: { loginId, by: user.role },
    });
    return this.get(user, studentId);
  }

  /** Turns the sign-in off and ends any open sessions. The password can be set again later. */
  async disable(user: AuthUser, studentId: string): Promise<StudentLoginStatus> {
    const s = await this.find(user, studentId);
    if (s.user?.active) {
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: s.user.id }, data: { active: false } }),
        this.prisma.refreshToken.updateMany({ where: { userId: s.user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await this.audit.record({ tenantId: s.branch.tenantId, actorId: user.id, action: 'student.login_disabled', entity: 'Student', entityId: s.id, data: { by: user.role } });
    }
    return this.get(user, studentId);
  }

  /** Parents reach only their own children; managers only students in their branch scope. Anything else is "not found". */
  private async find(user: AuthUser, studentId: string): Promise<StudentWithLogin> {
    const tenantId = requireTenant(user);
    const notFound = new NotFoundException('Student not found');
    const s = await this.prisma.student.findUnique({ where: { id: studentId }, include: studentInclude });
    if (!s || s.branch.tenantId !== tenantId) throw notFound;
    if (user.role === 'parent') {
      if (!s.guardians.some((g) => g.userId === user.id)) throw notFound;
    } else {
      await this.scope.branch(user, s.branchId).catch(() => {
        throw notFound;
      });
    }
    return s;
  }

  /** The admission number, upper-case. If another branch already uses it, prefix the branch code. */
  private async allocateLoginId(s: StudentWithLogin): Promise<string> {
    for (const id of [s.admissionNo.toUpperCase(), `${s.branch.code}-${s.admissionNo}`.toUpperCase()]) {
      if (!(await this.prisma.user.findUnique({ where: { username: id }, select: { id: true } }))) return id;
    }
    throw new ConflictException(`Login ID ${s.admissionNo} is already taken; change the admission number first`);
  }
}

const toStatus = (s: StudentWithLogin): StudentLoginStatus => ({
  studentId: s.id,
  studentName: s.name,
  className: s.class?.name ?? null,
  loginId: s.user?.passwordHash ? s.user.username : null,
  enabled: !!s.user?.active && !!s.user.passwordHash,
  lastLoginAt: s.user?.lastLoginAt?.toISOString() ?? null,
});

@Controller('student-logins')
@Roles('manager', 'parent')
export class StudentLoginsController {
  constructor(private readonly logins: StudentLoginsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthUser): Promise<StudentLoginStatus[]> {
    return this.logins.mine(user);
  }

  @Get(':studentId')
  get(@CurrentUser() user: AuthUser, @Param('studentId') id: string): Promise<StudentLoginStatus> {
    return this.logins.get(user, id);
  }

  @Put(':studentId')
  setPassword(@CurrentUser() user: AuthUser, @Param('studentId') id: string, @Body() dto: SetPasswordDto): Promise<StudentLoginStatus> {
    return this.logins.setPassword(user, id, dto.password);
  }

  @Delete(':studentId')
  @HttpCode(200)
  disable(@CurrentUser() user: AuthUser, @Param('studentId') id: string): Promise<StudentLoginStatus> {
    return this.logins.disable(user, id);
  }
}
