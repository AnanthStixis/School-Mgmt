import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  tenantId: string | null;
  actorId: string | null;
  /** e.g. auth.login, auth.login_failed, academic_year.create */
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Append-only audit trail. Never throws: a failed audit write must not break the request. */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(e: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: e.tenantId,
          actorId: e.actorId,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId ?? null,
          data: e.data,
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      this.log.error(`Audit write failed for ${e.action}: ${(err as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
