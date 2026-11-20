import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports degraded when the database is down', async () => {
    const c = new HealthController({ isUp: async () => false } as never);
    const r = await c.get();
    expect(r.status).toBe('degraded');
    expect(r.db).toBe('down');
  });

  it('reports ok when the database is up', async () => {
    const c = new HealthController({ isUp: async () => true } as never);
    expect((await c.get()).status).toBe('ok');
  });
});
