import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { canAccess, type ModuleKey, type Role } from '@sms/shared';
import type { Request } from 'express';
import type { AccessClaims, AuthUser } from './auth-user';
import { IS_PUBLIC, MODULE, ROLES } from './decorators';

/** Global guard: every route needs a valid bearer access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Sign in required');

    try {
      const c = await this.jwt.verifyAsync<AccessClaims>(token);
      req.user = { id: c.sub, role: c.role, tenantId: c.tid, branchId: c.bid };
      return true;
    } catch {
      throw new UnauthorizedException('Session expired');
    }
  }
}

/** Global guard: enforces @Roles() and @RequireModule() after authentication. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new UnauthorizedException();

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Your role cannot do this');

    const module = this.reflector.getAllAndOverride<ModuleKey | undefined>(MODULE, targets);
    if (module && !canAccess(module, user.role)) throw new ForbiddenException('Your role cannot open this module');

    return true;
  }
}
