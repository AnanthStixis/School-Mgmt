import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ATTENDANCE_STATUSES, type AttendanceOverview, type AttendanceStatus, type MarkableClass, type RegisterDto, type RegisterSaveInput, type RegisterSaveResult, type StudentAttendanceDto } from '@sms/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, Matches, ValidateNested } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequireModule, Roles } from '../auth/decorators';
import { AttendanceService } from './attendance.service';

class EntryDto {
  @IsString() studentId!: string;
  @IsIn(ATTENDANCE_STATUSES) status!: AttendanceStatus;
}

class SaveDto implements RegisterSaveInput {
  @IsString() classId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EntryDto) entries!: EntryDto[];
}

@Controller('attendance')
@RequireModule('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('classes')
  @Roles('manager', 'teacher')
  classes(@CurrentUser() user: AuthUser): Promise<MarkableClass[]> {
    return this.attendance.markable(user);
  }

  @Get('register')
  @Roles('manager', 'teacher')
  register(@CurrentUser() user: AuthUser, @Query('classId') classId: string, @Query('date') date?: string): Promise<RegisterDto> {
    return this.attendance.register(user, classId, date || undefined);
  }

  @Put('register')
  @Roles('manager', 'teacher')
  save(@CurrentUser() user: AuthUser, @Body() dto: SaveDto): Promise<RegisterSaveResult> {
    return this.attendance.save(user, dto);
  }

  @Get('overview')
  @Roles('manager')
  overview(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string): Promise<AttendanceOverview> {
    return this.attendance.overview(user, branchId || undefined);
  }

  /** Children a parent can view (or the student themself). */
  @Get('mine')
  @Roles('parent', 'student')
  mine(@CurrentUser() user: AuthUser) {
    return this.attendance.myStudents(user);
  }

  @Get('students/:id')
  student(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string): Promise<StudentAttendanceDto> {
    return this.attendance.student(user, id, from || undefined, to || undefined);
  }
}
