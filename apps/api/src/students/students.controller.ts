import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { GUARDIAN_RELATIONS, STUDENT_STATUSES, type GuardianInput, type Paged, type StudentDto, type StudentInput, type StudentListItem, type StudentStatus } from '@sms/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { StudentsService } from './students.service';

class GuardianDto implements GuardianInput {
  @IsString() @Length(2, 100, { message: 'Guardian name must be at least 2 characters' }) name!: string;
  // Loose length check only: the service validates the number and names the guardian in its message.
  @IsString() @Length(1, 20, { message: 'Guardian mobile number is required' }) phone!: string;
  @IsOptional() @IsString() @Length(0, 200) email?: string | null;
  @IsIn(GUARDIAN_RELATIONS) relation!: string;
  @IsOptional() @IsBoolean() primary?: boolean;
}

class StudentUpdateDto implements Partial<StudentInput> {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() @Length(0, 30) admissionNo?: string | null;
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsIn(['M', 'F', 'O', null]) gender?: string | null;
  @IsOptional() @IsString() dob?: string | null;
  @IsOptional() @IsString() classId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(200) rollNo?: number | null;
  @IsOptional() @IsString() @Length(0, 5) bloodGroup?: string | null;
  @IsOptional() @IsString() @Length(0, 30) house?: string | null;
  @IsOptional() @IsString() @Length(0, 300) address?: string | null;
  @IsOptional() @IsString() admittedOn?: string | null;
  @IsOptional() @IsIn(STUDENT_STATUSES) status?: StudentStatus;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => GuardianDto) guardians?: GuardianDto[];
}

class StudentCreateDto extends StudentUpdateDto implements StudentInput {
  @IsString() declare branchId: string;
  @IsString() @Length(2, 100) declare name: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => GuardianDto) declare guardians: GuardianDto[];
}

/** Teachers and accounts can view students in their branch; only managers can add or change them. */
@Controller('students')
@RequireModule('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('classId') classId?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Paged<StudentListItem>> {
    return this.students.list(user, { branchId, classId, status, q, page: Number(page) || 1, pageSize: Number(pageSize) || 25 });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<StudentDto> {
    return this.students.get(user, id);
  }

  @Post()
  @Roles('manager')
  async create(@CurrentUser() user: AuthUser, @Body() dto: StudentCreateDto): Promise<StudentDto> {
    const { id } = await this.students.create(user, dto);
    return this.students.get(user, id);
  }

  @Patch(':id')
  @Roles('manager')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StudentUpdateDto): Promise<StudentDto> {
    return this.students.update(user, id, dto);
  }
}
