import { checkEnvironment, devProvidersAllowed } from './runtime';

const good = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', JWT_SECRET: 'q7Vd2kP9xLm4Tz8RwYb3Nc6Hf1Jg5Ks0Ae7Ui2Op9', WEB_ORIGIN: 'https://fees.bnmpschool.in' };

describe('checkEnvironment', () => {
  it('passes a complete production environment, and anything in development', () => {
    expect(checkEnvironment(good)).toEqual([]);
    expect(checkEnvironment({})).toEqual([]);
  });

  it('lists what is missing or unsafe', () => {
    expect(checkEnvironment({ NODE_ENV: 'production' })).toEqual([
      'DATABASE_URL is not set',
      'JWT_SECRET must be at least 32 random characters',
      'WEB_ORIGIN is not set (the address parents and staff open, e.g. https://fees.bnmpschool.in)',
    ]);
    expect(checkEnvironment({ ...good, JWT_SECRET: 'change-me-change-me-change-me-change-me' })).toEqual(['JWT_SECRET looks like a placeholder; generate a random one']);
    expect(checkEnvironment({ ...good, WEB_ORIGIN: 'http://fees.bnmpschool.in' })).toEqual(['WEB_ORIGIN http://fees.bnmpschool.in must use https://']);
    expect(checkEnvironment({ ...good, SEED_PASSWORD: 'x' })).toHaveLength(1);
    expect(checkEnvironment({ ...good, SEED_PASSWORD: 'x', TEST_SYSTEM: 'true' })).toEqual([]);
  });

  it('allows the simulated SMS and payment providers only outside production or on a test system', () => {
    expect(devProvidersAllowed({})).toBe(true);
    expect(devProvidersAllowed({ NODE_ENV: 'production' })).toBe(false);
    expect(devProvidersAllowed({ NODE_ENV: 'production', TEST_SYSTEM: 'true' })).toBe(true);
  });
});
