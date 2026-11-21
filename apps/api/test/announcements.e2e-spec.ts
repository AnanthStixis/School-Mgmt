/**
 * Announcements and the notification feed: who may write to whom, who receives what on which
 * channel, read / unread, withdrawing, and fee reminders showing in the feed. Removes what it creates.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ANNOUNCEMENT_SMS_MAX } from '@sms/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { smsText } from '../src/notifications/announcements.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E-ANN';
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };

describe('Announcements and notifications (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });
  let ps: string;
  let c8a: string;
  let c8b: string;
  let c6b: string;
  const base = { priority: 'Normal', pinned: false, sms: false, email: false };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_SENDER).useValue(captureSms).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    for (const [who, email] of Object.entries({ director: 'director@bnmpschool.in', bm: 'anitha@bnmpschool.in', teacher: 'priya.sharma@bnmpschool.in', accounts: 'kavitha@bnmpschool.in' })) {
      t[who] = (await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    }
    await prisma.otpCode.deleteMany({ where: { phone: '+919800000001' } });
    await http.post('/api/auth/otp/request').send({ phone: '9800000001' }).expect(202);
    const code = sent.find((m) => m.phone === '+919800000001')!.text.match(/\d{6}/)![0];
    t.parent = (await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(200)).body.accessToken;
    ps = (await prisma.branch.findFirstOrThrow({ where: { code: 'BNMPS' } })).id;
    const year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
    const cls = async (name: string) => (await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name } })).id;
    [c8a, c8b, c6b] = [await cls('8-A'), await cls('8-B'), await cls('6-B')];
  });

  afterAll(async () => {
    await prisma.announcement.deleteMany({ where: { title: { startsWith: TAG } } });
    await app?.close();
  });

  it('previews who an announcement would reach', async () => {
    const all = await http.post('/api/announcements/preview').set(as('director')).send({ branchId: null, audience: 'PARENTS', sms: true, email: false }).expect(200);
    const one = await http.post('/api/announcements/preview').set(as('director')).send({ branchId: ps, audience: 'CLASSES', classIds: [c8a], sms: true, email: false }).expect(200);
    expect(all.body.parents).toBeGreaterThan(one.body.parents);
    expect(one.body.sms).toBeGreaterThan(0);
    expect(one.body.sms).toBeLessThanOrEqual(one.body.parents);
    const staff = await http.post('/api/announcements/preview').set(as('bm')).send({ branchId: null, audience: 'STAFF', sms: false, email: true }).expect(200);
    expect(staff.body).toMatchObject({ parents: 0 });
    expect(staff.body.staff).toBeGreaterThan(0);
    expect(staff.body.email).toBeGreaterThan(0); // staff have e-mail addresses
  });

  it('sends to the parents of a class: in-app for all, SMS to primary guardians only', async () => {
    sent.length = 0;
    const r = await http
      .post('/api/announcements')
      .set(as('bm'))
      .send({ ...base, branchId: ps, audience: 'CLASSES', classIds: [c8a], title: `${TAG} Science fair`, body: 'The Class 8 science fair is on Friday at 10 am. Parents are welcome.', priority: 'Important', pinned: true, sms: true })
      .expect(201);
    expect(r.body).toMatchObject({ audience: 'CLASSES', audienceLabel: 'Parents of 8-A · BNM Public School', priority: 'Important', pinned: true, read: 0, createdByName: 'Anitha Krishnan' });
    expect(r.body.smsSent).toBeGreaterThan(0);
    expect(r.body.recipients).toBeGreaterThanOrEqual(r.body.smsSent);
    // Suresh (Aarav is in 8-A) gets the SMS; parents of 6-B only don't.
    expect(sent.some((m) => m.phone === '+919800000001' && m.text.startsWith('BNM Public School: '))).toBe(true);
    const only6b = await prisma.studentGuardian.findFirst({ where: { primary: true, student: { classId: c6b }, user: { children: { none: { student: { classId: c8a } } } } }, include: { user: true } });
    if (only6b?.user.phone) expect(sent.some((m) => m.phone === only6b.user.phone)).toBe(false);
  });

  it('class teachers write only to their own class; accounts and parents cannot send', async () => {
    const send = (who: string, body: object) => http.post('/api/announcements').set(as(who)).send({ ...base, branchId: ps, title: `${TAG} Note`, body: 'Hello', ...body });
    await send('teacher', { audience: 'CLASSES', classIds: [c8a] }).expect(201);
    await send('teacher', { audience: 'CLASSES', classIds: [c8b] }).expect(403);
    await send('teacher', { audience: 'PARENTS' }).expect(403);
    await send('accounts', { audience: 'PARENTS' }).expect(403);
    await send('parent', { audience: 'PARENTS' }).expect(403);
    await send('bm', { audience: 'CLASSES', classIds: [] }).expect(400);
  });

  it('shows in the parent’s feed (pinned first) and announcement list; read and read-all', async () => {
    const feed = await http.get('/api/notifications').set(as('parent')).expect(200);
    const mine = feed.body.items.filter((n: { title: string }) => n.title.startsWith(TAG));
    expect(mine.length).toBe(2);
    expect(feed.body.items[0]).toMatchObject({ title: `${TAG} Science fair`, pinned: true, priority: 'Important', kind: 'announcement', link: '/communication', read: false });
    const unread = feed.body.unread;
    await http.post(`/api/notifications/${mine[0].id}/read`).expect(401);
    await http.post(`/api/notifications/${mine[0].id}/read`).set(as('parent')).expect(204);
    await http.post(`/api/notifications/${mine[0].id}/read`).set(as('teacher')).expect(404); // not theirs
    expect((await http.get('/api/notifications').set(as('parent')).expect(200)).body.unread).toBe(unread - 1);
    await http.post('/api/notifications/read-all').set(as('parent')).expect(200);
    expect((await http.get('/api/notifications').set(as('parent')).expect(200)).body.unread).toBe(0);

    const list = await http.get('/api/announcements').set(as('parent')).expect(200);
    expect(list.body.filter((a: { title: string }) => a.title.startsWith(TAG)).map((a: { title: string }) => a.title)[0]).toBe(`${TAG} Science fair`);
    const sentList = await http.get('/api/announcements').set(as('bm')).expect(200);
    expect(sentList.body.find((a: { title: string }) => a.title === `${TAG} Science fair`).read).toBeGreaterThanOrEqual(1);
  });

  it('a withdrawn announcement disappears from feeds; only the sender or a manager may withdraw', async () => {
    const ann = await prisma.announcement.findFirstOrThrow({ where: { title: `${TAG} Science fair` } });
    await http.post(`/api/announcements/${ann.id}/withdraw`).set(as('teacher')).expect(403);
    const r = await http.post(`/api/announcements/${ann.id}/withdraw`).set(as('bm')).expect(200);
    expect(r.body.withdrawnAt).toBeTruthy();
    const feed = await http.get('/api/notifications').set(as('parent')).expect(200);
    expect(feed.body.items.some((n: { title: string }) => n.title === `${TAG} Science fair`)).toBe(false);
    await http.post(`/api/announcements/${ann.id}/withdraw`).set(as('bm')).expect(400);
  });

  it('e-mails staff when asked, and fee reminders also land in the feed', async () => {
    const r = await http.post('/api/announcements').set(as('director')).send({ ...base, branchId: null, audience: 'STAFF', title: `${TAG} Staff meeting`, body: 'Staff meeting on Saturday at 1 pm in the hall.', email: true }).expect(201);
    expect(r.body.emailSent).toBeGreaterThan(0);
    expect(r.body.audienceLabel).toBe('All staff · All branches');
    const teacherFeed = await http.get('/api/notifications').set(as('teacher')).expect(200);
    expect(teacherFeed.body.items.some((n: { title: string }) => n.title === `${TAG} Staff meeting`)).toBe(true);

    await http.post('/api/fees/reminders').set(as('accounts')).send({}).expect(200);
    const feed = await http.get('/api/notifications').set(as('parent')).expect(200);
    expect(feed.body.items.some((n: { kind: string; link: string }) => n.kind === 'fee_reminder' && n.link === '/fees')).toBe(true);
  });

  it('cuts long SMS copies and points to the app', () => {
    const long = smsText('BNM Public School', 'Annual day', 'x '.repeat(400));
    expect(long.length).toBeLessThanOrEqual(ANNOUNCEMENT_SMS_MAX);
    expect(long.endsWith('Read more in the parent app.')).toBe(true);
    expect(smsText('BNM', 'Holiday', 'School is closed tomorrow.')).toBe('BNM: Holiday - School is closed tomorrow.');
  });
});
