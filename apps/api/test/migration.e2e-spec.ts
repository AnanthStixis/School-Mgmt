/**
 * Sprint 8 end-to-end tests: importing a SchoolElement student export, previous-year balances,
 * and the parallel-run comparison with SchoolElement's daily transactions. Removes what it creates.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { todayIST } from '../src/common/dates';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E8';
const uniq = String(Date.now()).slice(-6);
const adm = (n: number) => `${TAG}-${uniq}-${n}`;

describe('Data migration and parallel run (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });
  let ps: string;
  const today = todayIST();
  const [y, m, d] = today.split('-');
  const todayDMY = `${d}-${m}-${y}`;

  const studentsCsv = [
    'Admission No,Enrollment No,Student Name,Class/Section,Date of Birth,Gender,Father Name,Father Mobile,Mother Name,Mother Mobile,RTE/NON-RTE,New Admission or Re-Admission,Student Status',
    `${adm(1)},E1,${TAG} Kiran Rao,VIII-A,14-06-2013,Male,Ravi Rao,98${uniq}01,Sita Rao,98${uniq}02,NON-RTE,Re-Admission,Active`,
    `${adm(2)},E2,${TAG} Meena Das,VII-B,02/09/2014,Female,Arun Das,98${uniq}03,,,RTE,New Admission,Active`,
  ].join('\r\n');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    for (const [who, email] of Object.entries({ bm: 'anitha@bnmpschool.in', teacher: 'priya.sharma@bnmpschool.in', accounts: 'kavitha@bnmpschool.in' })) {
      t[who] = (await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    }
    ps = (await prisma.branch.findFirstOrThrow({ where: { code: 'BNMPS' } })).id;
  });

  afterAll(async () => {
    const sids = (await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((s) => s.id);
    await prisma.feeReceipt.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeAssignment.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeType.deleteMany({ where: { kind: 'PREVIOUS', assignments: { none: {} } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.student.deleteMany({ where: { id: { in: sids } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: `+9198${uniq}` }, children: { none: {} } } });
    await app?.close();
  });

  describe('students from a SchoolElement export', () => {
    it('reads its column names, Roman class names and Indian dates; reports columns it leaves out', async () => {
      const r = await http.post('/api/imports/students').set(as('bm')).send({ branchId: ps, csv: studentsCsv, dryRun: true }).expect(201);
      expect(r.body).toMatchObject({ dryRun: true, total: 2, valid: 2, invalid: 0, ignoredColumns: ['Enrollment No'] });
    });

    it('imports them with guardians and the fee profile (RTE, admission type)', async () => {
      const r = await http.post('/api/imports/students').set(as('bm')).send({ branchId: ps, csv: studentsCsv, dryRun: false }).expect(201);
      expect(r.body.created).toBe(2);
      const kiran = await prisma.student.findFirstOrThrow({ where: { admissionNo: adm(1) }, include: { class: true, guardians: { include: { user: true } } } });
      expect(kiran).toMatchObject({ name: `${TAG} Kiran Rao`, admissionType: 'Re-admission', rte: false });
      expect(kiran.class?.name).toBe('8-A');
      expect(kiran.guardians.map((g) => g.relation).sort()).toEqual(['Father', 'Mother']);
      const meena = await prisma.student.findFirstOrThrow({ where: { admissionNo: adm(2) }, include: { class: true } });
      expect(meena).toMatchObject({ admissionType: 'New Admission', rte: true });
      expect(meena.class?.name).toBe('7-B');
    });
  });

  describe('previous-year balances', () => {
    it('checks every row before importing anything', async () => {
      const csv = ['Admission No,Previous Balance,Remarks', `${adm(1)},"₹ 12,500",Term 3 unpaid`, 'NOPE-1,5000,', `${adm(2)},abc,`].join('\n');
      const r = await http.post('/api/imports/balances').set(as('accounts')).send({ branchId: ps, csv, dryRun: false }).expect(201);
      expect(r.body).toMatchObject({ invalid: 2, created: 0 });
      expect(r.body.rows.map((x: { errors: string[] }) => x.errors[0])).toEqual([expect.stringContaining('no student with admission_no NOPE-1'), expect.stringContaining('must be a whole number')]);
      await http.post('/api/imports/balances').set(as('teacher')).send({ branchId: ps, csv, dryRun: true }).expect(403);
    });

    it('adds a confirmed "Previous year balance" with no late fee, collectable at the counter', async () => {
      const csv = ['Admission No,Previous Balance,Remarks', `${adm(1)},"₹ 12,500",Term 3 unpaid`].join('\n');
      const r = await http.post('/api/imports/balances').set(as('accounts')).send({ branchId: ps, csv, dryRun: false }).expect(201);
      expect(r.body.created).toBe(1);
      const kiran = await prisma.student.findFirstOrThrow({ where: { admissionNo: adm(1) } });
      const fees = await http.get(`/api/fees/students/${kiran.id}`).set(as('accounts')).expect(200);
      const prev = fees.body.assignments.find((a: { kind: string }) => a.kind === 'PREVIOUS');
      expect(prev).toMatchObject({ status: 'CONFIRMED', gross: 12500, category: 'Balance from 2025-26 · Term 3 unpaid' });
      expect(prev.invoices[0]).toMatchObject({ balance: 12500, status: 'Overdue', lateFee: 0 });

      const again = await http.post('/api/imports/balances').set(as('accounts')).send({ branchId: ps, csv, dryRun: true }).expect(201);
      expect(again.body.rows[0].errors[0]).toContain('already has a previous-year balance');

      const v = await http.get(`/api/fees/collect/${kiran.id}`).set(as('accounts')).expect(200);
      const line = v.body.invoices.find((i: { feeTypeName: string }) => i.feeTypeName === 'Previous year balance');
      expect(line).toMatchObject({ balance: 12500, lateFee: 0 });
      await http.post('/api/fees/receipts').set(as('accounts')).send({ studentId: kiran.id, mode: 'Cash', lines: [{ invoiceId: line.invoiceId, fee: 12500, fine: 'pay' }] }).expect(201);
    });

    it('cannot be created or priced by hand', async () => {
      const year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
      await http.post('/api/fees/types').set(as('accounts')).send({ branchId: ps, academicYearId: year, kind: 'PREVIOUS', name: `${TAG} prev`, installments: [{ seq: 1, label: 'x', dueDate: '2026-06-01' }] }).expect(400);
    });
  });

  describe('parallel run', () => {
    it('compares SchoolElement’s day with our receipts, per student', async () => {
      const csv = [
        'Receipt Number,Paid Date,Admission No,Student Name,Amount Paid,Payment Type,Status',
        `BNMPS/2026-27/9001,${todayDMY},${adm(1)},${TAG} Kiran Rao,"12,500",CASH,SUCCESS`,
        `BNMPS/2026-27/9002,${todayDMY},${adm(2)},${TAG} Meena Das,"8,000",UPI,SUCCESS`,
        `BNMPS/2026-27/9003,${todayDMY},${adm(2)},${TAG} Meena Das,"8,000",UPI,FAILED`,
        `BNMPS/2026-27/9004,not a date,${adm(2)},,100,UPI,SUCCESS`,
      ].join('\n');
      const r = await http.post('/api/fees/parallel-run').set(as('accounts')).send({ branchId: ps, csv }).expect(200);
      expect(r.body).toMatchObject({ from: today, to: today });
      const mine = (a: string) => r.body.rows.find((x: { admissionNo: string }) => x.admissionNo === a.toUpperCase());
      expect(mine(adm(1))).toMatchObject({ status: 'MATCH', theirs: { total: 12500 }, ours: { total: 12500, count: 1 } });
      expect(mine(adm(2))).toMatchObject({ status: 'ONLY_THEIRS', theirs: { total: 8000, count: 1 } });
      expect(r.body.fileErrors).toEqual([{ line: 5, error: 'paid_date "not a date" is not a date' }]);
      await http.post('/api/fees/parallel-run').set(as('teacher')).send({ csv }).expect(403);
    });
  });
});
