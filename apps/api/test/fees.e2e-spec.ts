/**
 * Sprint 4 end-to-end tests: fee setup, the assign → confirm → publish → online lifecycle,
 * what parents can see, and fees assigned on enrolment. Restores what it changes.
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
const TAG = 'E2E4';
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };
const uniq = String(Date.now()).slice(-6);

describe('Fees setup and publishing (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  let ps: string;
  let pre: string;
  let year: string;
  let schoolFee: string;
  let cls6a: { id: string };
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_SENDER).useValue(captureSms).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    for (const [who, email] of Object.entries({ bm: 'anitha@bnmpschool.in', teacher: 'priya.sharma@bnmpschool.in', accounts: 'kavitha@bnmpschool.in' })) {
      t[who] = (await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    }
    await prisma.otpCode.deleteMany({ where: { phone: '+919800000001' } });
    await http.post('/api/auth/otp/request').send({ phone: '9800000001' }).expect(202);
    const code = sent.find((m) => m.phone === '+919800000001')!.text.match(/\d{6}/)![0];
    t.parent = (await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(200)).body.accessToken;

    const branches = await prisma.branch.findMany();
    ps = branches.find((b) => b.code === 'BNMPS')!.id;
    pre = branches.find((b) => b.code === 'BNMPRE')!.id;
    year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
    schoolFee = (await prisma.feeType.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, kind: 'SCHOOL' } })).id;
    cls6a = await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '6-A' } });
  });

  afterAll(async () => {
    const types = await prisma.feeType.findMany({ where: { name: { startsWith: TAG } } });
    await prisma.feeAssignment.deleteMany({ where: { feeTypeId: { in: types.map((x) => x.id) } } });
    await prisma.feeType.deleteMany({ where: { id: { in: types.map((x) => x.id) } } });
    const enq = await prisma.enquiry.findMany({ where: { childName: { startsWith: TAG } } });
    const byName = await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const sids = [...new Set([...enq.map((e) => e.studentId).filter((x): x is string => !!x), ...byName.map((s) => s.id)])];
    await prisma.enquiry.deleteMany({ where: { id: { in: enq.map((e) => e.id) } } });
    await prisma.feeAssignment.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.student.deleteMany({ where: { id: { in: sids } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: `+9191${uniq.slice(0, 2)}` }, children: { none: {} } } });
    await app?.close();
  });

  describe('setup', () => {
    it('is for accounts and managers of the branch; teachers and parents are refused', async () => {
      const s = await http.get(`/api/fees/setup?branchId=${ps}`).set(as('accounts')).expect(200);
      expect(s.body.bands.map((b: { name: string }) => b.name)).toEqual(['G1–G4', 'G5–G7', 'G8–G10', 'G11–G12']);
      expect(s.body.feeTypes.find((x: { kind: string }) => x.kind === 'SCHOOL').installments).toHaveLength(4);
      await http.get(`/api/fees/setup?branchId=${ps}`).set(as('teacher')).expect(403);
      await http.get(`/api/fees/setup?branchId=${ps}`).set(as('parent')).expect(403);
      await http.get(`/api/fees/setup?branchId=${pre}`).set(as('accounts')).expect(404);
    });

    it('validates installments, components and rate keys', async () => {
      const base = { branchId: ps, academicYearId: year, kind: 'CUSTOM', name: `${TAG} Excursion ${uniq}` };
      await http.post('/api/fees/types').set(as('accounts')).send({ ...base, installments: [{ seq: 1, label: 'A', dueDate: '2026-10-01' }, { seq: 2, label: 'B', dueDate: '2026-09-01' }] }).expect(400);
      await http.post('/api/fees/types').set(as('accounts')).send({ ...base, components: [{ name: 'X', percent: 60 }], installments: [{ seq: 1, label: 'A', dueDate: '2026-10-01' }] }).expect(400);
      await http.put(`/api/fees/types/${schoolFee}/rates`).set(as('accounts')).send({ rates: { 'G99|Re-admission': 1000 } }).expect(400);
    });

    it('refuses overlapping bands', () =>
      http.put('/api/fees/bands').set(as('accounts')).send({ branchId: ps, bands: [{ name: 'A', fromGrade: 1, toGrade: 5 }, { name: 'B', fromGrade: 5, toGrade: 8 }] }).expect(400));

    it('will not change installments once students have the fee', async () => {
      const r = await http.patch(`/api/fees/types/${schoolFee}`).set(as('accounts')).send({ installments: [{ seq: 1, label: 'Annual', dueDate: '2026-04-05' }] }).expect(409);
      expect(r.body.message).toMatch(/already have/);
    });
  });

  describe('assign → confirm → publish → online', () => {
    let custom: string;
    let ids: string[];

    beforeAll(async () => {
      const c = await http
        .post('/api/fees/types')
        .set(as('accounts'))
        .send({ branchId: ps, academicYearId: year, kind: 'CUSTOM', name: `${TAG} Science Fair ${uniq}`, installments: [{ seq: 1, label: 'Part 1', dueDate: '2026-12-10' }, { seq: 2, label: 'Part 2', dueDate: '2027-01-10' }] })
        .expect(201);
      custom = c.body.id;
      ids = (await prisma.student.findMany({ where: { classId: cls6a.id, status: 'Active' }, select: { id: true } })).map((s) => s.id);
    });

    it('needs an amount for a custom fee, then splits it into installments', async () => {
      const noAmount = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: ids, action: 'assign' }).expect(200);
      expect(noAmount.body.done).toBe(0);
      const r = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: ids, action: 'assign', amount: 1001 }).expect(200);
      expect(r.body.done).toBe(ids.length);
      const inv = await prisma.feeInvoice.findMany({ where: { assignment: { feeTypeId: custom, studentId: ids[0] } }, orderBy: { seq: 'asc' } });
      expect(inv.map((i) => i.gross)).toEqual([501, 500]);
    });

    it('enforces the order: publish needs confirm, online needs publish', async () => {
      const early = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: ids, action: 'publish' }).expect(200);
      expect(early.body.done).toBe(0);
      expect(early.body.skipped[0].reason).toBe('Confirm the invoice before publishing');
      const online = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: ids, action: 'online_on' }).expect(200);
      expect(online.body.skipped[0].reason).toMatch(/Publish the invoice/);
      for (const action of ['confirm', 'publish', 'online_on']) {
        const r = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: ids, action }).expect(200);
        expect(r.body.done).toBe(ids.length);
      }
      const board = await http.get(`/api/fees/board?feeTypeId=${custom}&classId=${cls6a.id}`).set(as('accounts')).expect(200);
      expect(board.body.counts).toMatchObject({ published: ids.length, online: ids.length, unassigned: 0 });
    });

    it('refuses to reset a published fee, and records actions in the audit log', async () => {
      const r = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: ids, action: 'reset' }).expect(200);
      expect(r.body.skipped[0].reason).toBe('Unpublish it first');
      const log = await prisma.auditLog.findFirst({ where: { entityId: custom, action: 'fee.publish' } });
      expect(log?.data).toMatchObject({ students: ids.length });
    });

    it('lets parents see only published fees of their own children', async () => {
      const aarav = await prisma.student.findFirstOrThrow({ where: { name: 'Aarav Menon' } });
      const r = await http.get(`/api/fees/students/${aarav.id}`).set(as('parent')).expect(200);
      expect(r.body.assignments.every((a: { status: string }) => a.status === 'PUBLISHED')).toBe(true);
      expect(r.body.assignments.map((a: { kind: string }) => a.kind).sort()).toEqual(['SCHOOL', 'TRANSPORT']);
      // An unpublished fee for Aarav is hidden from the parent but visible to accounts.
      await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: custom, studentIds: [aarav.id], action: 'assign', amount: 500 }).expect(200);
      const staffView = await http.get(`/api/fees/students/${aarav.id}`).set(as('accounts')).expect(200);
      expect(staffView.body.assignments).toHaveLength(3);
      expect((await http.get(`/api/fees/students/${aarav.id}`).set(as('parent'))).body.assignments).toHaveLength(2);
      const stranger = await prisma.student.findFirstOrThrow({ where: { branchId: pre } });
      await http.get(`/api/fees/students/${stranger.id}`).set(as('parent')).expect(404);
    });

    it('keeps existing invoices when the chart changes', async () => {
      const before = await prisma.feeRate.findMany({ where: { feeTypeId: schoolFee } });
      const rates = Object.fromEntries(before.map((r) => [r.key, r.key === 'G5–G7|Re-admission' ? 99999 : r.amount]));
      try {
        await http.put(`/api/fees/types/${schoolFee}/rates`).set(as('accounts')).send({ rates }).expect(200);
        const a = await prisma.feeAssignment.findFirstOrThrow({ where: { feeTypeId: schoolFee, category: 'G5–G7 · Re-admission' } });
        expect(a.gross).toBe(82000);
        const board = await http.get(`/api/fees/board?feeTypeId=${schoolFee}&classId=${cls6a.id}`).set(as('accounts')).expect(200);
        expect(board.body.rows.find((r: { assignment: { category: string } | null }) => r.assignment?.category === 'G5–G7 · Re-admission').quote.amount).toBe(99999);
      } finally {
        await http.put(`/api/fees/types/${schoolFee}/rates`).set(as('accounts')).send({ rates: Object.fromEntries(before.map((r) => [r.key, r.amount])) }).expect(200);
      }
    });
  });

  describe('enrolment', () => {
    it('assigns the school and application fees (unconfirmed) when admissions enrols a child', async () => {
      const e = (
        await http
          .post('/api/enquiries')
          .set(as('bm'))
          .send({ branchId: ps, academicYearId: year, childName: `${TAG} Newcomer`, grade: 6, parentName: `${TAG} Parent`, parentPhone: `91${uniq}01` })
          .expect(201)
      ).body;
      await http.post(`/api/enquiries/${e.id}/move`).set(as('bm')).send({ stage: 'Admitted' }).expect(200);
      const r = await http.post(`/api/enquiries/${e.id}/enrol`).set(as('bm')).send({ classId: cls6a.id }).expect(200);
      expect(r.body.activity.some((a: { text: string }) => /Fees assigned for review: School Fees 26-27 \(₹92,000\), Application Fee 26-27 \(₹1,500\)/.test(a.text))).toBe(true);
      const fees = await http.get(`/api/fees/students/${r.body.student.id}`).set(as('accounts')).expect(200);
      expect(fees.body.profile.admissionType).toBe('New Admission');
      expect(fees.body.assignments.map((a: { kind: string; status: string }) => [a.kind, a.status])).toEqual([
        ['SCHOOL', 'ASSIGNED'],
        ['APPLICATION', 'ASSIGNED'],
      ]);
    });
  });
});
