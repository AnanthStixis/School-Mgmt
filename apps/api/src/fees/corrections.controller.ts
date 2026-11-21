import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CONCESSION_METHODS,
  PAYMENT_MODES,
  type AdjustmentInput,
  type ClassSummaryDto,
  type ConcessionInput,
  type ConcessionMethod,
  type CorrectionDto,
  type CorrectionsReportDto,
  type DuesReportDto,
  type FineWaiverInput,
  type PaymentMode,
  type ReceiptDto,
  type RefundInput,
  type ReminderInput,
  type ReminderResult,
} from '@sms/shared';
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { CorrectionsService } from './corrections.service';

const REASON = { message: 'Give a reason (it appears on the reports)' };

class ConcessionDto implements ConcessionInput {
  @IsString() assignmentId!: string;
  @IsIn(['amount', 'percent']) basis!: 'amount' | 'percent';
  @IsNumber() @Min(0) @Max(10_000_000) value!: number;
  @IsIn(CONCESSION_METHODS) method!: ConcessionMethod;
  @IsOptional() @IsObject() manual?: Record<string, number>;
  @IsString() @Length(3, 200, REASON) remarks!: string;
}

class AdjustmentDto implements AdjustmentInput {
  @IsString() assignmentId!: string;
  @IsInt() @Min(1) @Max(10_000_000) amount!: number;
  @IsString() @Length(3, 200, REASON) remarks!: string;
}

class FineWaiverDto implements FineWaiverInput {
  @IsString() invoiceId!: string;
  @IsString() @Length(3, 200, REASON) remarks!: string;
}

class ReminderDto implements ReminderInput {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() classId?: string;
}

class RefundDtoIn implements RefundInput {
  @IsString() receiptId!: string;
  @IsInt() @Min(1) @Max(10_000_000) amount!: number;
  @IsIn(PAYMENT_MODES) mode!: PaymentMode;
  @IsOptional() @IsString() @Length(0, 80) bank?: string | null;
  @IsOptional() @IsString() @Length(0, 30) instrumentNo?: string | null;
  @IsString() @Length(3, 200, REASON) remarks!: string;
}

/** Fee corrections (concession, write-off, late fee waiver, refund) and fee reports: accounts and managers. */
@Controller('fees')
@RequireModule('fees')
@Roles('accounts', 'manager')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Post('concessions')
  concession(@CurrentUser() user: AuthUser, @Body() dto: ConcessionDto): Promise<CorrectionDto> {
    return this.corrections.concession(user, dto);
  }

  @Post('adjustments')
  adjustment(@CurrentUser() user: AuthUser, @Body() dto: AdjustmentDto): Promise<CorrectionDto> {
    return this.corrections.adjustment(user, dto);
  }

  @Post('fine-waivers')
  waive(@CurrentUser() user: AuthUser, @Body() dto: FineWaiverDto): Promise<CorrectionDto> {
    return this.corrections.waiveFine(user, dto);
  }

  @Post('refunds')
  refund(@CurrentUser() user: AuthUser, @Body() dto: RefundDtoIn): Promise<ReceiptDto> {
    return this.corrections.refund(user, dto);
  }

  @Post('reminders')
  @HttpCode(200)
  reminders(@CurrentUser() user: AuthUser, @Body() dto: ReminderDto): Promise<ReminderResult> {
    return this.corrections.sendReminders(user, dto);
  }

  @Get('students/:id/corrections')
  studentCorrections(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CorrectionDto[]> {
    return this.corrections.studentCorrections(user, id);
  }

  @Get('reports/dues')
  dues(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('classId') classId?: string,
    @Query('overdueOnly') overdueOnly?: string,
    @Query('academicYearId') academicYearId?: string,
  ): Promise<DuesReportDto> {
    return this.corrections.dues(user, { branchId: branchId || undefined, classId: classId || undefined, overdueOnly: overdueOnly === 'true', academicYearId: academicYearId || undefined });
  }

  @Get('reports/classes')
  classes(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('academicYearId') academicYearId?: string): Promise<ClassSummaryDto> {
    return this.corrections.classSummary(user, { branchId: branchId || undefined, academicYearId: academicYearId || undefined });
  }

  @Get('reports/corrections')
  report(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('kind') kind?: string): Promise<CorrectionsReportDto> {
    return this.corrections.correctionsReport(user, { branchId: branchId || undefined, from: from || undefined, to: to || undefined, kind: kind || undefined });
  }
}
