import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AcademicYearsController } from './academic-years/academic-years.controller';
import { AdmissionsController } from './admissions/admissions.controller';
import { AdmissionsService } from './admissions/admissions.service';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { AuditModule } from './audit/audit.service';
import { CollectionController } from './fees/collection.controller';
import { CollectionService } from './fees/collection.service';
import { FeesController } from './fees/fees.controller';
import { FeesService } from './fees/fees.service';
import { AuthModule } from './auth/auth.module';
import { BranchesController } from './branches/branches.controller';
import { ScopeModule } from './common/scope.service';
import { HealthController } from './health/health.controller';
import { ImportsController } from './imports/imports.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ClassesController } from './setup/classes.controller';
import { SubjectsController } from './setup/subjects.controller';
import { StaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';
import { StudentLoginsController, StudentLoginsService } from './students/student-logins';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuditModule, ScopeModule, AuthModule],
  controllers: [
    HealthController,
    BranchesController,
    AcademicYearsController,
    SubjectsController,
    ClassesController,
    StaffController,
    StudentsController,
    StudentLoginsController,
    ImportsController,
    AdmissionsController,
    AttendanceController,
    FeesController,
    CollectionController,
  ],
  providers: [StaffService, StudentsService, StudentLoginsService, AdmissionsService, AttendanceService, FeesService, CollectionService],
})
export class AppModule {}
