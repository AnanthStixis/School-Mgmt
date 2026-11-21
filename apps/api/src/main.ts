import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module';
import { checkEnvironment, isTestSystem } from './config/runtime';
import { configureApp } from './setup';

async function bootstrap() {
  const problems = checkEnvironment();
  if (problems.length) {
    console.error(`Refusing to start:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind the Vite proxy / a reverse proxy: trust the first hop so req.ip is the client's address.
  app.set('trust proxy', 1);
  configureApp(app);
  serveWebApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api${isTestSystem() ? ' (TEST SYSTEM: SMS and payments are simulated)' : ''}`);
}

/**
 * With WEB_DIST set (the web app's build folder), the API also serves the web app, so a small
 * installation runs as one process behind one HTTPS proxy. Built assets are cached for a year
 * (their names change on every build); index.html is never cached.
 */
function serveWebApp(app: NestExpressApplication) {
  const dir = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : null;
  if (!dir) return;
  const index = join(dir, 'index.html');
  if (!existsSync(index)) throw new Error(`WEB_DIST=${dir} has no index.html; run the web build first`);
  app.useStaticAssets(dir, {
    index: false,
    setHeaders: (res, path) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  });
  // Any other page address (e.g. /fees, /receipts/…) is the single-page app.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  console.log(`Serving the web app from ${dir}`);
}

bootstrap();
