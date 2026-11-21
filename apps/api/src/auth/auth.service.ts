import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, type AuthResponse, type SessionUser } from '@sms/shared';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessClaims } from './auth-user';
import { normalisePhone, SMS_SENDER, type SmsSender } from './sms';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 30;

/** Used so a login with an unknown e-mail costs the same time as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession extends AuthResponse {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly otpSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {
    this.otpSecret = config.getOrThrow<string>('JWT_SECRET');
  }

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  }

  toSessionUser(u: User): SessionUser {
    return { id: u.id, name: u.name, email: u.email, role: u.role, title: u.title, tenantId: u.tenantId, branchId: u.branchId };
  }

  // ---------- password sign-in (staff) ----------

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Students sign in with their login ID, not an e-mail.
    return this.checkPassword(user?.role === 'student' ? null : user, password, client, 'Invalid e-mail or password', 'password');
  }

  // ---------- student sign-in (login ID + password set by a parent or the school) ----------

  async studentLogin(loginId: string, password: string, client: ClientInfo): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { username: loginId.trim().toUpperCase() } });
    return this.checkPassword(user?.role === 'student' ? user : null, password, client, 'Invalid login ID or password', 'student_password');
  }

  /**
   * Shared password check. Unknown accounts cost the same bcrypt time as real ones, and an account
   * is locked for a while after repeated wrong passwords (counted from the audit trail).
   */
  private async checkPassword(user: User | null, password: string, client: ClientInfo, failMessage: string, method: string): Promise<IssuedSession> {
    if (user && (await this.recentFailures(user)) >= LOGIN_MAX_FAILURES) {
      throw new HttpException(`Too many wrong attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok || !user.active) {
      await this.audit.record({
        tenantId: user?.tenantId ?? null,
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'User',
        entityId: user?.id,
        data: { method },
        ip: client.ip,
      });
      throw new UnauthorizedException(failMessage);
    }
    return this.startSession(user, 'password', client);
  }

  /** Wrong passwords in the lock window, ignoring any before the last successful sign-in. */
  private recentFailures(user: User): Promise<number> {
    const windowStart = new Date(Date.now() - LOGIN_LOCK_MINUTES * 60_000);
    const since = user.lastLoginAt && user.lastLoginAt > windowStart ? user.lastLoginAt : windowStart;
    return this.prisma.auditLog.count({ where: { entity: 'User', entityId: user.id, action: 'auth.login_failed', at: { gt: since } } });
  }

  // ---------- OTP sign-in (parents, and staff without a password) ----------

  /**
   * Sends a code if the number belongs to an active user. Always answers the same way,
   * so the endpoint cannot be used to discover which numbers are registered.
   */
  async requestOtp(rawPhone: string): Promise<void> {
    const phone = normalisePhone(rawPhone);
    if (!phone) throw new HttpException('Enter a valid 10-digit mobile number', HttpStatus.BAD_REQUEST);

    const last = await this.prisma.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_SECONDS * 1000) {
      throw new HttpException(`Please wait ${OTP_RESEND_SECONDS} seconds before asking for another code`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { phone } });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Record a row even for unknown numbers so the resend limit applies uniformly.
    await this.prisma.otpCode.create({
      data: { phone, codeHash: this.hashOtp(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000) },
    });
    // Students sign in with their login ID and password, never by mobile code.
    if (user?.active && user.role !== 'student') {
      await this.sms.send(phone, `${code} is your BNM School sign-in code. It expires in 5 minutes. Do not share it.`);
    }
  }

  async verifyOtp(rawPhone: string, code: string, client: ClientInfo): Promise<IssuedSession> {
    const phone = normalisePhone(rawPhone);
    const invalid = new UnauthorizedException('Invalid or expired code');
    if (!phone) throw invalid;

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw invalid;

    if (otp.codeHash !== this.hashOtp(phone, code)) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }

    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.active || user.role === 'student') throw invalid;

    // Single use: consume atomically so two parallel requests cannot both succeed.
    const { count } = await this.prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (count !== 1) throw invalid;

    return this.startSession(user, 'otp', client);
  }

  // ---------- sessions ----------

  /** Exchanges a refresh token for a new pair. Re-use of a revoked token ends all of that user's sessions. */
  async refresh(token: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    const invalid = new UnauthorizedException('Session expired, please sign in again');
    if (!token) throw invalid;

    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row) throw invalid;

    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({
        tenantId: row.user.tenantId,
        actorId: row.userId,
        action: 'auth.refresh_reuse',
        entity: 'User',
        entityId: row.userId,
        ip: client.ip,
      });
      throw invalid;
    }
    if (row.expiresAt < new Date() || !row.user.active) throw invalid;

    const { count } = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (count !== 1) throw invalid;

    return this.issue(row.user, client);
  }

  async logout(token: string | undefined, actorId?: string): Promise<void> {
    if (!token) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row) return;
    await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ tenantId: row.user.tenantId, actorId: actorId ?? row.userId, action: 'auth.logout', entity: 'User', entityId: row.userId });
  }

  async me(userId: string): Promise<SessionUser> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.active) throw new UnauthorizedException();
    return this.toSessionUser(u);
  }

  private async startSession(user: User, method: 'password' | 'otp', client: ClientInfo): Promise<IssuedSession> {
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      data: { method },
      ip: client.ip,
    });
    return this.issue(user, client);
  }

  private async issue(user: User, client: ClientInfo): Promise<IssuedSession> {
    const claims: AccessClaims = { sub: user.id, role: user.role, tid: user.tenantId, bid: user.branchId };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: ACCESS_TTL_SECONDS });

    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
        userAgent: client.userAgent?.slice(0, 300),
      },
    });
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, user: this.toSessionUser(user), refreshToken };
  }

  private hashOtp(phone: string, code: string): string {
    return createHmac('sha256', this.otpSecret).update(`${phone}:${code}`).digest('hex');
  }
}
