import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { STAFF_ACCESS, type StaffAccess, type StaffDto, type StaffInput } from '@sms/shared';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule } from '../auth/decorators';
import { StaffService, toStaffDto } from './staff.service';

class StaffUpdateDto implements Partial<StaffInput> {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @Length(2, 60) role?: string;
  @IsOptional() @IsString() @Length(0, 60) subject?: string | null;
  @IsOptional() @IsString() @Length(0, 200) email?: string | null;
  @IsOptional() @IsString() @Length(0, 20, { message: 'Mobile number is too long' }) phone?: string | null;
  @IsOptional() @IsString() @Length(0, 100) qualification?: string | null;
  @IsOptional() @IsString() joinedOn?: string | null;
  @IsOptional() @IsIn(['Active', 'Inactive']) status?: 'Active' | 'Inactive';
  @IsOptional() @IsIn(STAFF_ACCESS) access?: StaffAccess;
}

class StaffCreateDto extends StaffUpdateDto implements StaffInput {
  @IsString() declare branchId: string;
  @IsString() @Length(2, 100) declare name: string;
  @IsString() @Length(2, 60) declare role: string;
}

/** Staff directory and login access. Payroll comes in phase 2. */
@Controller('staff')
@RequireModule('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('q') search?: string, @Query('status') status?: string): Promise<StaffDto[]> {
    return this.staff.list(user, { branchId, search: search?.trim() || undefined, status });
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StaffDto> {
    return toStaffDto(await this.staff.find(user, id));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: StaffCreateDto): Promise<StaffDto> {
    return this.staff.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StaffUpdateDto): Promise<StaffDto> {
    return this.staff.update(user, id, dto);
  }
}
