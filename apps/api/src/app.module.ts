import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AcademicYearsController } from './academic-years/academic-years.controller';
import { AdmissionsController } from './admissions/admissions.controller';
import { AdmissionsService } from './admissions/admissions.service';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { AuditModule } from './audit/audit.service';
import { CollectionController } from './fees/collection.controller';
import { devProvidersAllowed } from './config/runtime';
import { CorrectionsController } from './fees/corrections.controller';
import { CorrectionsService } from './fees/corrections.service';
import { ParallelRunService } from './fees/parallel-run';
import { AnnouncementsService } from './notifications/announcements.service';
import { ConsoleEmailSender, EMAIL_SENDER } from './notifications/email';
import { AnnouncementsController, NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { DevGateway, PAYMENT_GATEWAY } from './payments/gateway';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
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
    CorrectionsController,
    PaymentsController,
    NotificationsController,
    AnnouncementsController,
  ],
  providers: [StaffService, StudentsService, StudentLoginsService, AdmissionsService, AttendanceService, FeesService,
    CollectionService,
    CorrectionsService,
    ParallelRunService,
    NotificationsService,
    AnnouncementsService,
    // E-mail: console in development / test systems; off on the live system until a provider is configured.
    { provide: EMAIL_SENDER, useFactory: () => (devProvidersAllowed() ? new ConsoleEmailSender() : null) },
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (!devProvidersAllowed()) throw new Error('No payment gateway configured: the development gateway must not run in production (set TEST_SYSTEM=true only on a test system)');
        return new DevGateway(config.getOrThrow<string>('JWT_SECRET'), config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5174');
      },
    },
  ],
})
export class AppModule {}
