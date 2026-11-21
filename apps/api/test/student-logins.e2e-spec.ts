/**
 * Student sign-in: login ID (admission number) + a password set by the parent or the school.
 * Uses the seeded family: Suresh Menon (parent) with Aarav (has a login) and Diya (gets one here).
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

describe('Student sign-in (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });
  let aarav: { id: string; admissionNo: string };
  let diya: { id: string; admissionNo: string };

  /** Removes Diya's sign-in so every run starts the same way. */
  const resetDiya = async () => {
    const s = await prisma.student.findUniqueOrThrow({ where: { id: diya.id } });
    if (!s.userId) return;
    await prisma.student.update({ where: { id: s.id }, data: { userId: null } });
    await prisma.refreshToken.deleteMany({ where: { userId: s.userId } });
    await prisma.user.delete({ where: { id: s.userId } });
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_SENDER).useValue(captureSms).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    aarav = await prisma.student.findFirstOrThrow({ where: { name: 'Aarav Menon' } });
    diya = await prisma.student.findFirstOrThrow({ where: { name: 'Diya Menon' } });
    await resetDiya();

    for (const [who, email] of Object.entries({ bm: 'anitha@bnmpschool.in', teacher: 'priya.sharma@bnmpschool.in' })) {
      t[who] = (await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    }
    await prisma.otpCode.deleteMany({ where: { phone: '+919800000001' } });
    await http.post('/api/auth/otp/request').send({ phone: '9800000001' }).expect(202);
    const code = sent.find((m) => m.phone === '+919800000001')!.text.match(/\d{6}/)![0];
    t.parent = (await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await resetDiya();
    await app?.close();
  });

  it('lets a student sign in with their admission number (any case), but not by e-mail', async () => {
    const r = await http.post('/api/auth/student-login').send({ loginId: aarav.admissionNo.toLowerCase(), password: PASSWORD }).expect(200);
    expect(r.body.user).toMatchObject({ name: 'Aarav Menon', role: 'student' });
    await http.post('/api/auth/login').send({ email: 'aarav.menon@students.bnmpschool.in', password: PASSWORD }).expect(401);
  });

  it('shows the parent each child’s sign-in status', async () => {
    const r = await http.get('/api/student-logins/mine').set(as('parent')).expect(200);
    const byName = Object.fromEntries(r.body.map((x: { studentName: string }) => [x.studentName, x]));
    expect(byName['Aarav Menon']).toMatchObject({ enabled: true, loginId: aarav.admissionNo.toUpperCase() });
    expect(byName['Diya Menon']).toMatchObject({ enabled: false, loginId: null });
  });

  it('checks the password the parent chooses', async () => {
    const short = await http.put(`/api/student-logins/${diya.id}`).set(as('parent')).send({ password: 'abc12' }).expect(400);
    expect(String(short.body.message)).toContain('8 to 72 characters');
    const same = await http.put(`/api/student-logins/${diya.id}`).set(as('parent')).send({ password: diya.admissionNo.toLowerCase() }).expect(400);
    expect(same.body.message).toBe('The password cannot be the same as the login ID');
  });

  it('parent sets a password; the student signs in and sees only herself', async () => {
    const r = await http.put(`/api/student-logins/${diya.id}`).set(as('parent')).send({ password: 'diya-e2e-pass1' }).expect(200);
    expect(r.body).toMatchObject({ enabled: true, loginId: diya.admissionNo.toUpperCase() });

    const s = await http.post('/api/auth/student-login').set('x-client', 'mobile').send({ loginId: diya.admissionNo, password: 'diya-e2e-pass1' }).expect(200);
    t.diya = s.body.accessToken;
    t.diyaRefresh = s.body.refreshToken;
    const mine = await http.get('/api/attendance/mine').set(as('diya')).expect(200);
    expect(mine.body.map((x: { name: string }) => x.name)).toEqual(['Diya Menon']);
    // Students cannot manage sign-ins.
    await http.get(`/api/student-logins/${diya.id}`).set(as('diya')).expect(403);
  });

  it('a reset by the school ends the student’s other sessions', async () => {
    await http.put(`/api/student-logins/${diya.id}`).set(as('bm')).send({ password: 'diya-e2e-pass2' }).expect(200);
    await http.post('/api/auth/refresh').set('x-client', 'mobile').send({ refreshToken: t.diyaRefresh }).expect(401);
  });

  it('keeps parents to their own children and teachers out', async () => {
    const other = await prisma.student.findFirstOrThrow({ where: { name: { not: { in: ['Aarav Menon', 'Diya Menon'] } }, guardians: { none: { user: { phone: '+919800000001' } } } } });
    await http.get(`/api/student-logins/${other.id}`).set(as('parent')).expect(404);
    await http.put(`/api/student-logins/${other.id}`).set(as('parent')).send({ password: 'whatever-123' }).expect(404);
    await http.get(`/api/student-logins/${diya.id}`).set(as('teacher')).expect(403);
    await http.get(`/api/student-logins/${diya.id}`).set(as('bm')).expect(200);
  });

  it('parent turns the sign-in off; repeated wrong passwords lock the account', async () => {
    const r = await http.delete(`/api/student-logins/${diya.id}`).set(as('parent')).expect(200);
    expect(r.body.enabled).toBe(false);
    await http.post('/api/auth/student-login').send({ loginId: diya.admissionNo, password: 'diya-e2e-pass2' }).expect(401);
    for (let i = 0; i < 4; i++) await http.post('/api/auth/student-login').send({ loginId: diya.admissionNo, password: `wrong-${i}` }).expect(401);
    const locked = await http.post('/api/auth/student-login').send({ loginId: diya.admissionNo, password: 'diya-e2e-pass2' }).expect(429);
    expect(locked.body.message).toContain('Too many wrong attempts');
  });
});
