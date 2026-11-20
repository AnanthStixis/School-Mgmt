import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ADMISSION_TYPES,
  FEE_ACTIONS,
  FEE_KINDS,
  PICKUP_MODES,
  type AssignBoardDto,
  type FeeAction,
  type FeeActionInput,
  type FeeActionResult,
  type FeeBandDto,
  type FeeKind,
  type FeeOverviewDto,
  type FeeProfile,
  type FeeSetupDto,
  type FeeTypeDto,
  type FeeTypeInput,
  type FeeTypeUpdate,
  type StudentFeesDto,
} from '@sms/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { FeesService } from './fees.service';

class InstallmentDto {
  @IsInt() seq!: number;
  @IsString() @Length(1, 60) label!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
}

class ComponentDto {
  @IsString() @Length(1, 60) name!: string;
  @IsInt() @Min(1) @Max(100) percent!: number;
}

class FeeTypeUpdateDto implements FeeTypeUpdate {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ComponentDto) components?: ComponentDto[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => InstallmentDto) installments?: InstallmentDto[];
  @IsOptional() @IsBoolean() ratesConfirmed?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

class FeeTypeCreateDto extends FeeTypeUpdateDto implements FeeTypeInput {
  @IsString() branchId!: string;
  @IsString() academicYearId!: string;
  @IsIn(FEE_KINDS) kind!: FeeKind;
  @IsString() @Length(2, 80) declare name: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => InstallmentDto) declare installments: InstallmentDto[];
}

class BandDto {
  @IsString() @Length(1, 30) name!: string;
  @IsInt() @Min(-2) @Max(12) fromGrade!: number;
  @IsInt() @Min(-2) @Max(12) toGrade!: number;
}

class BandsDto {
  @IsString() branchId!: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BandDto) bands!: BandDto[];
}

class RatesDto {
  /** key → annual amount in rupees */
  @IsObject() rates!: Record<string, number>;
}

class CopyDto {
  @IsString() academicYearId!: string;
}

class ActionDto implements FeeActionInput {
  @IsString() feeTypeId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) studentIds!: string[];
  @IsIn(FEE_ACTIONS) action!: FeeAction;
  @IsOptional() @IsInt() @Min(1) @Max(10_000_000) amount?: number;
}

class ProfileDto implements Partial<FeeProfile> {
  @IsOptional() @IsIn(ADMISSION_TYPES) admissionType?: string;
  @IsOptional() @IsBoolean() rte?: boolean;
  @IsOptional() @IsBoolean() staffKid?: boolean;
  @IsOptional() @IsString() @Length(0, 40) transportSlab?: string | null;
  @IsOptional() @IsIn([...PICKUP_MODES, null]) pickupMode?: string | null;
}

/** Fees & Invoices. Setup, assignment and publishing: accounts and managers. Parents: read their children's published fees. */
@Controller('fees')
@RequireModule('fees')
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get('overview')
  @Roles('accounts', 'manager')
  overview(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('academicYearId') academicYearId?: string): Promise<FeeOverviewDto> {
    return this.fees.overview(user, branchId || undefined, academicYearId || undefined);
  }

  @Get('setup')
  @Roles('accounts', 'manager')
  setup(@CurrentUser() user: AuthUser, @Query('branchId') branchId: string, @Query('academicYearId') academicYearId?: string): Promise<FeeSetupDto> {
    return this.fees.setup(user, branchId, academicYearId || undefined);
  }

  @Put('bands')
  @Roles('accounts', 'manager')
  bands(@CurrentUser() user: AuthUser, @Body() dto: BandsDto): Promise<FeeBandDto[]> {
    return this.fees.saveBands(user, dto.branchId, dto.bands);
  }

  @Post('types')
  @Roles('accounts', 'manager')
  createType(@CurrentUser() user: AuthUser, @Body() dto: FeeTypeCreateDto): Promise<FeeTypeDto> {
    return this.fees.createType(user, dto);
  }

  @Patch('types/:id')
  @Roles('accounts', 'manager')
  updateType(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FeeTypeUpdateDto): Promise<FeeTypeDto> {
    return this.fees.updateType(user, id, dto);
  }

  @Put('types/:id/rates')
  @Roles('accounts', 'manager')
  rates(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RatesDto): Promise<FeeTypeDto> {
    return this.fees.saveRates(user, id, dto.rates);
  }

  @Post('types/:id/copy')
  @Roles('accounts', 'manager')
  copy(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CopyDto): Promise<FeeTypeDto> {
    return this.fees.copyType(user, id, dto.academicYearId);
  }

  @Get('board')
  @Roles('accounts', 'manager')
  board(@CurrentUser() user: AuthUser, @Query('feeTypeId') feeTypeId: string, @Query('classId') classId: string): Promise<AssignBoardDto> {
    return this.fees.board(user, feeTypeId, classId);
  }

  @Post('actions')
  @HttpCode(200)
  @Roles('accounts', 'manager')
  act(@CurrentUser() user: AuthUser, @Body() dto: ActionDto): Promise<FeeActionResult> {
    return this.fees.act(user, dto);
  }

  /** A student's fee account. Parents see only published fees of their own children. */
  @Get('students/:id')
  student(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('academicYearId') academicYearId?: string): Promise<StudentFeesDto> {
    return this.fees.studentFees(user, id, academicYearId || undefined);
  }

  @Patch('students/:id/profile')
  @Roles('accounts', 'manager')
  profile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ProfileDto): Promise<FeeProfile> {
    return this.fees.updateProfile(user, id, dto);
  }
}
