import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';

/** Shared app configuration, used by main.ts and the end-to-end tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // CSV imports are sent as JSON text; 6 MB covers the 2,000-row limit with room to spare.
  (app as NestExpressApplication).useBodyParser('json', { limit: '6mb' });
  app.use(cookieParser());
  app.use(securityHeaders);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? false, credentials: true });
  app.enableShutdownHooks();
}

/**
 * Browser security headers on every response. The content security policy only allows this site's own
 * scripts, styles, images and API, so injected content can't load anything from elsewhere.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
