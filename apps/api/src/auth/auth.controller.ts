import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthResponse, SessionUser } from '@sms/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthUser } from './auth-user';
import { AuthService, REFRESH_TTL_DAYS, type ClientInfo, type IssuedSession } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { LoginDto, OtpRequestDto, OtpVerifyDto, RefreshDto } from './dto';

export const REFRESH_COOKIE = 'sms_rt';

const cookieOpts = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth',
});

/** Mobile apps cannot rely on cookies, so they get the refresh token in the body instead. */
const isMobile = (req: Request) => req.headers['x-client'] === 'mobile';
const clientInfo = (req: Request): ClientInfo => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    return this.respond(await this.auth.login(dto.email, dto.password, clientInfo(req)), req, res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(@Body() dto: OtpRequestDto): Promise<{ message: string }> {
    await this.auth.requestOtp(dto.phone);
    return { message: 'If this number is registered, a code has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    return this.respond(await this.auth.verifyOtp(dto.phone, dto.code, clientInfo(req)), req, res);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const token = dto.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    try {
      return this.respond(await this.auth.refresh(token, clientInfo(req)), req, res);
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, cookieOpts());
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(dto.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOpts());
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.me(user.id);
  }

  private respond(s: IssuedSession, req: Request, res: Response): AuthResponse {
    const { refreshToken, ...body } = s;
    if (isMobile(req)) return { ...body, refreshToken };
    res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOpts(), maxAge: REFRESH_TTL_DAYS * 86_400_000 });
    return body;
  }
}
