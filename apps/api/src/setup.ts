import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/** Shared app configuration, used by main.ts and the end-to-end tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // CSV imports are sent as JSON text; 6 MB covers the 2,000-row limit with room to spare.
  (app as NestExpressApplication).useBodyParser('json', { limit: '6mb' });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? false, credentials: true });
  app.enableShutdownHooks();
}
