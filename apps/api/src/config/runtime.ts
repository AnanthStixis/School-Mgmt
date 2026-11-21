/**
 * How the API is running.
 * - development: local machine (`pnpm dev`).
 * - production: the live school system. Real SMS and payment providers are required.
 * - test system: a hosted copy for the accounts team's acceptance tests (NODE_ENV=production and
 *   TEST_SYSTEM=true). It uses the development SMS sender and payment gateway, so no real messages
 *   or payments happen, and the web app shows a "test system" banner.
 */
export const isProduction = (env = process.env) => env.NODE_ENV === 'production';
export const isTestSystem = (env = process.env) => env.TEST_SYSTEM === 'true';
/** The console SMS sender and the development payment gateway may run here. */
export const devProvidersAllowed = (env = process.env) => !isProduction(env) || isTestSystem(env);

/** Problems with the environment that must stop a production (or test-system) start. Empty when fine. */
export function checkEnvironment(env = process.env): string[] {
  if (!isProduction(env)) return [];
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 random characters');
  if (env.JWT_SECRET && /change|secret|password|example/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET looks like a placeholder; generate a random one');
  const origins = (env.WEB_ORIGIN ?? '').split(',').filter(Boolean);
  if (!origins.length) problems.push('WEB_ORIGIN is not set (the address parents and staff open, e.g. https://fees.bnmpschool.in)');
  for (const o of origins) {
    if (!/^https:\/\//.test(o) && !/^http:\/\/localhost(:\d+)?$/.test(o)) problems.push(`WEB_ORIGIN ${o} must use https://`);
  }
  if (env.SEED_PASSWORD && !isTestSystem(env)) problems.push('SEED_PASSWORD is for local development only; remove it from the production environment');
  return problems;
}
