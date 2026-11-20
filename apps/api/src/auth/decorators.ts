import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ModuleKey, Role } from '@sms/shared';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const MODULE = 'module';

/** Route needs no access token (login, health…). Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these roles may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Caller's role must be allowed to open this module (same rules as the web sidebar, from @sms/shared). */
export const RequireModule = (module: ModuleKey) => SetMetadata(MODULE, module);

/** Injects the signed-in user into a handler parameter. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
