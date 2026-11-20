import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC, MODULE, ROLES } from './decorators';
import { AccessGuard, JwtAuthGuard } from './guards';

const ctx = (req: object): ExecutionContext =>
  ({ getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

const reflectorWith = (meta: Record<string, unknown>) => ({ getAllAndOverride: (key: string) => meta[key] }) as unknown as Reflector;

const user = (role: AuthUser['role']): AuthUser => ({ id: 'u1', role, tenantId: 't1', branchId: null });

describe('AccessGuard', () => {
  it('lets a role through when the module allows it', () => {
    const g = new AccessGuard(reflectorWith({ [MODULE]: 'fees' }));
    expect(g.canActivate(ctx({ user: user('accounts') }))).toBe(true);
  });

  it('blocks a role the module does not allow (same rule as the POC sidebar)', () => {
    const g = new AccessGuard(reflectorWith({ [MODULE]: 'fees' }));
    expect(() => g.canActivate(ctx({ user: user('teacher') }))).toThrow(ForbiddenException);
  });

  it('keeps the platform admin out of school modules', () => {
    const g = new AccessGuard(reflectorWith({ [MODULE]: 'students' }));
    expect(() => g.canActivate(ctx({ user: user('admin') }))).toThrow(ForbiddenException);
  });

  it('enforces @Roles', () => {
    const g = new AccessGuard(reflectorWith({ [ROLES]: ['manager'] }));
    expect(g.canActivate(ctx({ user: user('manager') }))).toBe(true);
    expect(() => g.canActivate(ctx({ user: user('parent') }))).toThrow(ForbiddenException);
  });

  it('skips public routes', () => {
    const g = new AccessGuard(reflectorWith({ [IS_PUBLIC]: true, [ROLES]: ['manager'] }));
    expect(g.canActivate(ctx({}))).toBe(true);
  });
});

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'x'.repeat(32) });

  it('rejects requests without a bearer token', async () => {
    const g = new JwtAuthGuard(jwt, reflectorWith({}));
    await expect(g.canActivate(ctx({ headers: {} }))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'y'.repeat(32) }).signAsync({ sub: 'u1', role: 'manager', tid: 't1', bid: null });
    const g = new JwtAuthGuard(jwt, reflectorWith({}));
    await expect(g.canActivate(ctx({ headers: { authorization: `Bearer ${forged}` } }))).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the user from a valid token', async () => {
    const token = await jwt.signAsync({ sub: 'u1', role: 'teacher', tid: 't1', bid: 'b1' });
    const req: { headers: object; user?: AuthUser } = { headers: { authorization: `Bearer ${token}` } };
    await new JwtAuthGuard(jwt, reflectorWith({})).canActivate(ctx(req));
    expect(req.user).toEqual({ id: 'u1', role: 'teacher', tenantId: 't1', branchId: 'b1' });
  });
});
