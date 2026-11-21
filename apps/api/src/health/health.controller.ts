import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@sms/shared';
import { Public } from '../auth/decorators';
import { devProvidersAllowed } from '../config/runtime';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(): Promise<HealthResponse> {
    const db = (await this.prisma.isUp()) ? 'up' : 'down';
    return { status: db === 'up' ? 'ok' : 'degraded', version: '0.1.0', db, time: new Date().toISOString(), testSystem: devProvidersAllowed() };
  }
}
