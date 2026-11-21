import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { FINE_ACTIONS, PAYMENT_MODES, type CollectDto, type CollectInput, type CollectLineInput, type FineAction, type PaymentMode, type ReceiptDto, type ReceiptListItem, type ReceiptRegisterDto } from '@sms/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { CollectionService } from './collection.service';

class CollectLineDto implements CollectLineInput {
  @IsString() invoiceId!: string;
  @IsInt() @Min(0) @Max(10_000_000) fee!: number;
  @IsIn(FINE_ACTIONS) fine!: FineAction;
}

class CollectDtoIn implements CollectInput {
  @IsString() studentId!: string;
  @IsIn(PAYMENT_MODES) mode!: PaymentMode;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CollectLineDto) lines!: CollectLineDto[];
  @IsOptional() @IsString() @Length(0, 80) bank?: string | null;
  @IsOptional() @IsString() @Length(0, 30) instrumentNo?: string | null;
  @IsOptional() @IsString() @Length(0, 10) instrumentDate?: string | null;
  @IsOptional() @IsString() @Length(0, 60) reference?: string | null;
  @IsOptional() @IsString() @Length(0, 300) remarks?: string | null;
  @IsOptional() @IsString() @Length(0, 200) waiveReason?: string | null;
}

class CancelDto {
  @IsString() @Length(3, 200, { message: 'Give a reason for cancelling the receipt' }) reason!: string;
}

class ReconDto {
  @IsBoolean() ok!: boolean;
  @IsOptional() @IsString() @Length(0, 200) note?: string;
}

/** Counter collection and receipts. Accounts and managers collect; parents can read their children's receipts. */
@Controller('fees')
@RequireModule('fees')
export class CollectionController {
  constructor(private readonly collection: CollectionService) {}

  @Get('collect/:studentId')
  @Roles('accounts', 'manager')
  view(@CurrentUser() user: AuthUser, @Param('studentId') id: string): Promise<CollectDto> {
    return this.collection.collectView(user, id);
  }

  @Post('receipts')
  @Roles('accounts', 'manager')
  collect(@CurrentUser() user: AuthUser, @Body() dto: CollectDtoIn): Promise<ReceiptDto> {
    return this.collection.collect(user, dto);
  }

  @Get('receipts')
  @Roles('accounts', 'manager')
  register(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode?: string,
    @Query('recon') recon?: string,
  ): Promise<ReceiptRegisterDto> {
    return this.collection.register(user, { branchId: branchId || undefined, from: from || undefined, to: to || undefined, mode: mode || undefined, recon: recon || undefined });
  }

  @Get('receipts/:id')
  receipt(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ReceiptDto> {
    return this.collection.receipt(user, id);
  }

  @Post('receipts/:id/cancel')
  @HttpCode(200)
  @Roles('accounts', 'manager')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto): Promise<ReceiptDto> {
    return this.collection.cancel(user, id, dto.reason);
  }

  @Post('receipts/:id/recon')
  @HttpCode(200)
  @Roles('accounts', 'manager')
  reconcile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReconDto): Promise<ReceiptDto> {
    return this.collection.reconcile(user, id, dto.ok, dto.note);
  }

  @Get('students/:id/receipts')
  studentReceipts(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ReceiptListItem[]> {
    return this.collection.studentReceipts(user, id);
  }
}
