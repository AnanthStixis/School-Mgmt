import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DEV_OUTCOMES, ONLINE_MODES, type DevOutcome, type OnlinePaymentsReportDto, type PaymentAttemptDto, type StartPaymentDto, type StartPaymentInput } from '@sms/shared';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Public, RequireModule, Roles } from '../auth/decorators';
import { PaymentsService } from './payments.service';

class StartDto implements StartPaymentInput {
  @IsString() studentId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @IsString({ each: true }) invoiceIds!: string[];
}

class DevCompleteDto {
  @IsIn(DEV_OUTCOMES) outcome!: DevOutcome;
  @IsIn(ONLINE_MODES) mode!: string;
}

/** Online fee payments: parents pay; accounts and managers see every attempt. */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('online')
  @RequireModule('fees')
  @Roles('parent')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartDto): Promise<StartPaymentDto> {
    return this.payments.start(user, dto);
  }

  @Get('online')
  @RequireModule('fees')
  @Roles('accounts', 'manager')
  report(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('status') status?: string): Promise<OnlinePaymentsReportDto> {
    return this.payments.report(user, { branchId: branchId || undefined, from: from || undefined, to: to || undefined, status: status || undefined });
  }

  @Get('online/:orderId')
  @RequireModule('fees')
  get(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string): Promise<PaymentAttemptDto> {
    return this.payments.get(user, orderId);
  }

  /** Development gateway checkout page → simulated bank answer. 404 when a real gateway is configured. */
  @Post('dev/:orderId/complete')
  @HttpCode(200)
  @RequireModule('fees')
  @Roles('parent')
  devComplete(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Body() dto: DevCompleteDto): Promise<PaymentAttemptDto> {
    return this.payments.devComplete(user, orderId, dto.outcome, dto.mode);
  }

  /** Server-to-server notification from the gateway. Authenticated by its signature, not a login. */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('webhook/:gateway')
  @HttpCode(200)
  webhook(@Param('gateway') gateway: string, @Body() body: unknown, @Headers('x-signature') signature?: string): Promise<{ ok: true }> {
    return this.payments.webhook(gateway, body, signature);
  }
}
