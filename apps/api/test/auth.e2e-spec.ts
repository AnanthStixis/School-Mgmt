/**
 * End-to-end auth and access tests against a real, migrated and seeded database.
 * Needs DATABASE_URL, JWT_SECRET and SEED_PASSWORD (see apps/api/.env.example).
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };

describe('Auth & access (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  const login = async (email: string) => {
    const r = await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { token: r.body.accessToken as string, cookie: String(r.headers['set-cookie']).split(';')[0] };
  };

  beforeAll(async () => {
    if (!PASSWORD) throw new Error('SEED_PASSWORD must be set for e2e tests');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_SENDER).useValue(captureSms).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    // Start from a clean OTP state so resend limits from earlier runs don't interfere.
    await app.get(PrismaService).otpCode.deleteMany({ where: { phone: '+919800000001' } });
  });

  afterAll(() => app?.close());

  it('requires a token for protected routes', () => http.get('/api/branches').expect(401));

  it('rejects a wrong password without revealing which part was wrong', async () => {
    const r = await http.post('/api/auth/login').send({ email: 'director@bnmpschool.in', password: 'wrong' }).expect(401);
    expect(r.body.message).toBe('Invalid e-mail or password');
  });

  it('scopes branches: director sees all, branch manager only their own', async () => {
    const dir = await login('director@bnmpschool.in');
    const bm = await login('anitha@bnmpschool.in');
    expect((await http.get('/api/branches').set('authorization', `Bearer ${dir.token}`)).body).toHaveLength(3);
    const own = (await http.get('/api/branches').set('authorization', `Bearer ${bm.token}`)).body;
    expect(own.map((b: { code: string }) => b.code)).toEqual(['BNMPS']);
  });

  it('only trust-level managers may change academic years', async () => {
    const bm = await login('anitha@bnmpschool.in');
    const teacher = await login('priya.sharma@bnmpschool.in');
    const body = { label: '2099-00', startsOn: '2099-04-01', endsOn: '2100-03-31' };
    await http.post('/api/academic-years').set('authorization', `Bearer ${bm.token}`).send(body).expect(403);
    await http.post('/api/academic-years').set('authorization', `Bearer ${teacher.token}`).send(body).expect(403);
  });

  it('keeps the platform admin out of school data', async () => {
    const admin = await login('meera@stixis.io');
    await http.get('/api/academic-years').set('authorization', `Bearer ${admin.token}`).expect(403);
  });

  it('rotates refresh tokens and treats reuse as theft', async () => {
    const { cookie } = await login('kavitha@bnmpschool.in');
    const r1 = await http.post('/api/auth/refresh').set('cookie', cookie).expect(200);
    await http.post('/api/auth/refresh').set('cookie', cookie).expect(401);
    const rotated = String(r1.headers['set-cookie']).split(';')[0];
    await http.post('/api/auth/refresh').set('cookie', rotated).expect(401);
  });

  it('signs a parent in with an OTP, once', async () => {
    await http.post('/api/auth/otp/request').send({ phone: '98000 00001' }).expect(202);
    const msg = sent.find((m) => m.phone === '+919800000001');
    const code = msg?.text.match(/\d{6}/)?.[0];
    expect(code).toBeDefined();

    await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code: code === '000000' ? '111111' : '000000' }).expect(401);
    const ok = await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(200);
    expect(ok.body.user.role).toBe('parent');
    await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(401);
  });

  it('does not reveal whether a phone number is registered', async () => {
    const r = await http.post('/api/auth/otp/request').send({ phone: '9811111111' }).expect(202);
    expect(r.body.message).toMatch(/If this number is registered/);
    expect(sent.find((m) => m.phone === '+919811111111')).toBeUndefined();
  });
});
