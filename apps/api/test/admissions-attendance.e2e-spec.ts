/**
 * Sprint 3 end-to-end tests: admissions pipeline and enrolment, attendance registers,
 * absence alerts, and who may see what. Restores any data it changes.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays, dayDate, todayIST, weekday } from '../src/common/dates';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E3';
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };
const uniq = String(Date.now()).slice(-6);

/** Latest Mon–Sat on or before today, so the suite works on any day of the week. */
function schoolDay(): string {
  let d = todayIST();
  while (weekday(d) === 'Sun') d = addDays(d, -1);
  return d;
}

describe('Admissions and attendance (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  let ps: string;
  let pre: string;
  let year: string;
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_SENDER).useValue(captureSms).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    for (const [who, email] of Object.entries({ director: 'director@bnmpschool.in', bm: 'anitha@bnmpschool.in', teacher: 'priya.sharma@bnmpschool.in' })) {
      t[who] = (await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    }
    // Parent signs in by OTP (code captured from the fake SMS sender).
    await prisma.otpCode.deleteMany({ where: { phone: '+919800000001' } });
    await http.post('/api/auth/otp/request').send({ phone: '9800000001' }).expect(202);
    const code = sent.find((m) => m.phone === '+919800000001')!.text.match(/\d{6}/)![0];
    t.parent = (await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(200)).body.accessToken;

    const branches = await prisma.branch.findMany();
    ps = branches.find((b) => b.code === 'BNMPS')!.id;
    pre = branches.find((b) => b.code === 'BNMPRE')!.id;
    year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
  });

  afterAll(async () => {
    const enq = await prisma.enquiry.findMany({ where: { childName: { startsWith: TAG } } });
    // Also catch students left behind by an earlier interrupted run (matched by name).
    const byName = await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const studentIds = [...new Set([...enq.map((e) => e.studentId).filter((x): x is string => !!x), ...byName.map((s) => s.id)])];
    await prisma.enquiry.deleteMany({ where: { id: { in: enq.map((e) => e.id) } } });
    await prisma.attendanceRecord.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.feeAssignment.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: `+9192${uniq.slice(0, 2)}` }, children: { none: {} } } });
    await app?.close();
  });

  describe('admissions', () => {
    const base = () => ({ branchId: ps, academicYearId: year, grade: 8, parentName: `${TAG} Parent`, source: 'Referral' });

    it('is for managers only, within their branch', async () => {
      await http.get('/api/enquiries').set(as('teacher')).expect(403);
      await http.post('/api/enquiries').set(as('bm')).send({ ...base(), branchId: pre, childName: `${TAG} Other`, parentPhone: `92${uniq}01` }).expect(404);
    });

    it('records an enquiry with a timeline and flags a likely duplicate', async () => {
      const body = { ...base(), childName: `${TAG} Kid`, parentPhone: `92${uniq}02` };
      const a = await http.post('/api/enquiries').set(as('bm')).send(body).expect(201);
      expect(a.body.stage).toBe('Enquiry');
      expect(a.body.activity[0].kind).toBe('created');
      const b = await http.post('/api/enquiries').set(as('bm')).send(body).expect(201);
      expect(b.body.possibleDuplicateOf).toBe(a.body.id);
    });

    it('moves through the pipeline, refuses early enrolment, then enrols into a class', async () => {
      const e = (await http.post('/api/enquiries').set(as('bm')).send({ ...base(), childName: `${TAG} Enrol`, parentPhone: `92${uniq}03`, gender: 'F', dob: '2014-05-05' }).expect(201)).body;
      await http.post(`/api/enquiries/${e.id}/enrol`).set(as('bm')).send({}).expect(409);
      for (const stage of ['Applied', 'Test/Interview', 'Admitted']) await http.post(`/api/enquiries/${e.id}/move`).set(as('bm')).send({ stage }).expect(200);
      const cls = await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '8-A' } });
      const r = await http.post(`/api/enquiries/${e.id}/enrol`).set(as('bm')).send({ classId: cls.id, guardianRelation: 'Mother' }).expect(200);
      expect(r.body.stage).toBe('Enrolled');
      expect(r.body.student.admissionNo).toMatch(/^BNMPS26-\d{4}$/);
      const s = await prisma.student.findUniqueOrThrow({ where: { id: r.body.student.id }, include: { guardians: true } });
      expect(s).toMatchObject({ name: `${TAG} Enrol`, classId: cls.id, gender: 'F' });
      expect(s.guardians[0].relation).toBe('Mother');
      // No double enrolment, no dropping an enrolled child, no stage change.
      await http.post(`/api/enquiries/${e.id}/enrol`).set(as('bm')).send({}).expect(409);
      await http.post(`/api/enquiries/${e.id}/drop`).set(as('bm')).send({ reason: 'test' }).expect(409);
      await http.post(`/api/enquiries/${e.id}/move`).set(as('bm')).send({ stage: 'Applied' }).expect(409);
    });

    it('links an enrolled child to an existing family by parent mobile', async () => {
      const e = (await http.post('/api/enquiries').set(as('bm')).send({ ...base(), childName: `${TAG} Menon`, parentName: 'Suresh Menon', parentPhone: '98000 00001' }).expect(201)).body;
      await http.post(`/api/enquiries/${e.id}/move`).set(as('bm')).send({ stage: 'Admitted' }).expect(200);
      const r = await http.post(`/api/enquiries/${e.id}/enrol`).set(as('bm')).send({}).expect(200);
      const st = await http.get(`/api/students/${r.body.student.id}`).set(as('bm')).expect(200);
      expect(st.body.siblings.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['Aarav Menon', 'Diya Menon']));
    });

    it('requires a reason to drop, and can re-open a dropped enquiry', async () => {
      const e = (await http.post('/api/enquiries').set(as('bm')).send({ ...base(), childName: `${TAG} Drop`, parentPhone: `92${uniq}04` }).expect(201)).body;
      await http.post(`/api/enquiries/${e.id}/drop`).set(as('bm')).send({ reason: '' }).expect(400);
      const d = await http.post(`/api/enquiries/${e.id}/drop`).set(as('bm')).send({ reason: 'Moved city' }).expect(200);
      expect(d.body).toMatchObject({ stage: 'Dropped', dropReason: 'Moved city' });
      const list = await http.get('/api/enquiries').set(as('bm')).expect(200);
      expect(list.body.find((x: { id: string }) => x.id === e.id)).toBeUndefined(); // dropped hidden by default
      const back = await http.post(`/api/enquiries/${e.id}/move`).set(as('bm')).send({ stage: 'Enquiry' }).expect(200);
      expect(back.body.activity[0].text).toBe('Re-opened at Enquiry');
    });

    it('reports pipeline stats', async () => {
      const s = await http.get('/api/enquiries/stats').set(as('director')).expect(200);
      expect(s.body.total).toBeGreaterThan(0);
      expect(s.body.byStage.Enrolled).toBeGreaterThanOrEqual(2);
      expect(s.body.bySource.length).toBeGreaterThan(0);
    });
  });

  describe('attendance', () => {
    const day = schoolDay();
    let cls8a: string;
    let snapshot: { studentId: string; classId: string; date: Date; status: string }[] = [];
    let hadRegister = false;

    beforeAll(async () => {
      cls8a = (await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '8-A' } })).id;
      snapshot = (await prisma.attendanceRecord.findMany({ where: { classId: cls8a, date: dayDate(day) } })).map(({ studentId, classId, date, status }) => ({ studentId, classId, date, status }));
      hadRegister = !!(await prisma.attendanceRegister.findUnique({ where: { classId_date: { classId: cls8a, date: dayDate(day) } } }));
    });

    afterAll(async () => {
      // Put the day's register back exactly as it was.
      await prisma.attendanceRecord.deleteMany({ where: { classId: cls8a, date: dayDate(day) } });
      if (snapshot.length) await prisma.attendanceRecord.createMany({ data: snapshot });
      if (!hadRegister) await prisma.attendanceRegister.deleteMany({ where: { classId: cls8a, date: dayDate(day) } });
      await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: 'absence:' }, createdAt: { gte: new Date(Date.now() - 3600_000) }, text: { contains: '(8-A)' } } });
    });

    it('lets a class teacher mark only their own class', async () => {
      const mine = await http.get('/api/attendance/classes').set(as('teacher')).expect(200);
      expect(mine.body.map((c: { name: string }) => c.name)).toEqual(['8-A']);
      const other = await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '7-A' } });
      await http.get(`/api/attendance/register?classId=${other.id}`).set(as('teacher')).expect(403);
    });

    it('requires every student to be marked', async () => {
      const reg = (await http.get(`/api/attendance/register?classId=${cls8a}&date=${day}`).set(as('teacher')).expect(200)).body;
      expect(reg.canEdit).toBe(true);
      const partial = reg.entries.slice(1).map((e: { studentId: string }) => ({ studentId: e.studentId, status: 'P' }));
      await http.put('/api/attendance/register').set(as('teacher')).send({ classId: cls8a, date: day, entries: partial }).expect(400);
    });

    it('saves a register, alerts the absent student’s parent once, and records who submitted', async () => {
      const reg = (await http.get(`/api/attendance/register?classId=${cls8a}&date=${day}`).set(as('teacher')).expect(200)).body;
      const aarav = reg.entries.find((e: { name: string }) => e.name === 'Aarav Menon');
      const entries = reg.entries.map((e: { studentId: string }) => ({ studentId: e.studentId, status: e.studentId === aarav.studentId ? 'A' : 'P' }));
      sent.length = 0;
      const r1 = (await http.put('/api/attendance/register').set(as('teacher')).send({ classId: cls8a, date: day, entries }).expect(200)).body;
      expect(r1).toMatchObject({ absent: 1, present: entries.length - 1 });
      if (day === todayIST()) {
        expect(r1.alertsSent).toBe(1);
        expect(sent.find((m) => m.phone === '+919800000001')?.text).toMatch(/Aarav Menon \(8-A\) was marked absent/);
        const r2 = (await http.put('/api/attendance/register').set(as('teacher')).send({ classId: cls8a, date: day, entries }).expect(200)).body;
        expect(r2.alertsSent).toBe(0); // re-submitting never alerts twice
      }
      const again = (await http.get(`/api/attendance/register?classId=${cls8a}&date=${day}`).set(as('teacher')).expect(200)).body;
      expect(again.submitted.by).toBe('Priya Sharma');
      expect(again.entries.find((e: { studentId: string }) => e.studentId === aarav.studentId).status).toBe('A');
    });

    it('refuses future dates, Sundays, and old dates for teachers (but not managers)', async () => {
      const reg = (d: string, who: string) => http.get(`/api/attendance/register?classId=${cls8a}&date=${d}`).set(as(who)).expect(200);
      expect((await reg(addDays(todayIST(), 1), 'teacher')).body).toMatchObject({ canEdit: false, editNote: expect.stringMatching(/future/) });
      let sunday = todayIST();
      while (weekday(sunday) !== 'Sun') sunday = addDays(sunday, -1);
      expect((await reg(sunday, 'bm')).body.notWorkingDay).toMatch(/Sun is not a working day/);
      let old = addDays(todayIST(), -10);
      while (weekday(old) === 'Sun') old = addDays(old, -1);
      expect((await reg(old, 'teacher')).body).toMatchObject({ canEdit: false, editNote: expect.stringMatching(/up to 2 days back/) });
      expect((await reg(old, 'bm')).body.canEdit).toBe(true);
    });

    it('gives managers an overview with at-risk students; teachers cannot see it', async () => {
      await http.get('/api/attendance/overview').set(as('teacher')).expect(403);
      const o = (await http.get('/api/attendance/overview').set(as('bm')).expect(200)).body;
      expect(o.classes).toHaveLength(12);
      expect(o.classes[0].recent.length).toBeGreaterThan(0);
      expect(o.atRisk.every((s: { percent: number; threshold: number }) => s.percent < s.threshold)).toBe(true);
    });

    it('lets a parent see only their own children', async () => {
      const kids = (await http.get('/api/attendance/mine').set(as('parent')).expect(200)).body as { id: string; name: string }[];
      expect(kids.map((k) => k.name)).toEqual(expect.arrayContaining(['Aarav Menon', 'Diya Menon']));
      const cal = (await http.get(`/api/attendance/students/${kids[0].id}`).set(as('parent')).expect(200)).body;
      expect(cal.days.length).toBeGreaterThan(10);
      const stranger = await prisma.student.findFirstOrThrow({ where: { branchId: pre } });
      await http.get(`/api/attendance/students/${stranger.id}`).set(as('parent')).expect(404);
      await http.get('/api/attendance/overview').set(as('parent')).expect(403);
    });
  });
});
