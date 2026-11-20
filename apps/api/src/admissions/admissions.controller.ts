import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ENQUIRY_SOURCES, ENQUIRY_STAGES, GUARDIAN_RELATIONS, type AdmissionStats, type EnquiryDetailDto, type EnquiryDto, type EnquiryInput, type EnrolInput, type PipelineStage } from '@sms/shared';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule } from '../auth/decorators';
import { AdmissionsService } from './admissions.service';

class EnquiryUpdateDto implements Partial<EnquiryInput> {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() academicYearId?: string;
  @IsOptional() @IsString() @Length(2, 100) childName?: string;
  @IsOptional() @IsIn(['M', 'F', 'O', null]) gender?: string | null;
  @IsOptional() @IsString() dob?: string | null;
  @IsOptional() @IsInt() @Min(-2) @Max(12) grade?: number;
  @IsOptional() @IsString() @Length(2, 100) parentName?: string;
  @IsOptional() @IsString() @Length(1, 20, { message: 'Parent mobile is required' }) parentPhone?: string;
  @IsOptional() @IsString() @Length(0, 20) altPhone?: string | null;
  @IsOptional() @IsString() @Length(0, 200) parentEmail?: string | null;
  @IsOptional() @IsString() @Length(0, 80) city?: string | null;
  @IsOptional() @IsString() @Length(0, 300) address?: string | null;
  @IsOptional() @IsString() @Length(0, 120) previousSchool?: string | null;
  @IsOptional() @IsString() @Length(0, 40) previousBoard?: string | null;
  @IsOptional() @IsBoolean() siblingInSchool?: boolean;
  @IsOptional() @IsIn(ENQUIRY_SOURCES) source?: string;
  @IsOptional() @IsString() nextFollowUp?: string | null;
}

class EnquiryCreateDto extends EnquiryUpdateDto implements EnquiryInput {
  @IsString() declare branchId: string;
  @IsString() declare academicYearId: string;
  @IsString() @Length(2, 100) declare childName: string;
  @IsInt() @Min(-2) @Max(12) declare grade: number;
  @IsString() @Length(2, 100) declare parentName: string;
  @IsString() @Length(1, 20, { message: 'Parent mobile is required' }) declare parentPhone: string;
}

class MoveDto {
  @IsIn(ENQUIRY_STAGES) stage!: PipelineStage;
}

class DropDto {
  @IsString() @Length(3, 300, { message: 'Give a short reason (at least 3 characters)' }) reason!: string;
}

class NoteDto {
  @IsString() @Length(1, 1000) text!: string;
  @IsOptional() @IsString() nextFollowUp?: string | null;
}

class EnrolDto implements EnrolInput {
  @IsOptional() @IsString() classId?: string | null;
  @IsOptional() @IsString() @Length(0, 30) admissionNo?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(200) rollNo?: number | null;
  @IsOptional() @IsIn(['Active', 'Temporary']) status?: 'Active' | 'Temporary';
  @IsOptional() @IsIn(GUARDIAN_RELATIONS) guardianRelation?: string;
}

/** Admissions CRM: managers only (POC rule). */
@Controller('enquiries')
@RequireModule('admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('stage') stage?: string,
    @Query('q') q?: string,
    @Query('includeClosed') includeClosed?: string,
  ): Promise<EnquiryDto[]> {
    return this.admissions.list(user, { branchId, academicYearId, stage, q, includeClosed: includeClosed === 'true' });
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string, @Query('academicYearId') academicYearId?: string): Promise<AdmissionStats> {
    return this.admissions.stats(user, { branchId, academicYearId });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<EnquiryDetailDto> {
    return this.admissions.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: EnquiryCreateDto): Promise<EnquiryDetailDto> {
    return this.admissions.create(user, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EnquiryUpdateDto): Promise<EnquiryDetailDto> {
    return this.admissions.update(user, id, dto);
  }

  @Post(':id/move')
  @HttpCode(200)
  move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MoveDto): Promise<EnquiryDetailDto> {
    return this.admissions.move(user, id, dto.stage);
  }

  @Post(':id/drop')
  @HttpCode(200)
  drop(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DropDto): Promise<EnquiryDetailDto> {
    return this.admissions.drop(user, id, dto.reason);
  }

  @Post(':id/notes')
  @HttpCode(200)
  note(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: NoteDto): Promise<EnquiryDetailDto> {
    return this.admissions.note(user, id, dto.text, dto.nextFollowUp);
  }

  @Post(':id/enrol')
  @HttpCode(200)
  enrol(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EnrolDto): Promise<EnquiryDetailDto> {
    return this.admissions.enrol(user, id, dto);
  }
}
