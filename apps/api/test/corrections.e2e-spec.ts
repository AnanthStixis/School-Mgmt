/**
 * Sprint 6 end-to-end tests: concessions (equal / order-wise / manual, replacing the previous one),
 * late fee waivers, write-offs, refunds against receipts, and the fee reports.
 * Works on its own test student and removes it afterwards.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FeeAssignmentDto, ReceiptDto } from '@sms/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { todayIST } from '../src/common/dates';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E6';
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };
const uniq = String(Date.now()).slice(-6);

describe('Fee corrections and reports (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });
  let studentId: string;
  let fee: FeeAssignmentDto;
  let receipt: ReceiptDto;
  const today = todayIST();

  const load = async () => {
    const r = await http.get(`/api/fees/students/${studentId}`).set(as('accounts')).expect(200);
    fee = r.body.assignments[0];
    return fee;
  };
  const inv = (n: number) => fee.invoices[n - 1];

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

    const ps = (await prisma.branch.findFirstOrThrow({ where: { code: 'BNMPS' } })).id;
    const year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
    const cls = await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '6-A' } });
    const feeType = await prisma.feeType.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, kind: 'SCHOOL' } });
    const s = await http
      .post('/api/students')
      .set(as('bm'))
      .send({ branchId: ps, classId: cls.id, name: `${TAG} Corrections ${uniq}`, guardians: [{ name: 'E2E Parent', phone: `+9189${uniq}01`, relation: 'Father', primary: true }] })
      .expect(201);
    studentId = s.body.id;
    for (const action of ['assign', 'confirm']) await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: feeType.id, studentIds: [studentId], action }).expect(200);
    await load();
    // Installment 1 is paid in full (late fee collected).
    receipt = (await http.post('/api/fees/receipts').set(as('accounts')).send({ studentId, mode: 'Cash', lines: [{ invoiceId: inv(1).id, fee: inv(1).balance, fine: 'pay' }] }).expect(201)).body;
    await load();
  });

  afterAll(async () => {
    const sids = (await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((s) => s.id);
    await prisma.feeRefund.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeCorrection.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeReceipt.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeAssignment.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.student.deleteMany({ where: { id: { in: sids } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: '+9189' }, children: { none: {} } } });
    await app?.close();
  });

  describe('concession', () => {
    it('spreads a percentage equally over the unpaid installments only', async () => {
      const r = await http.post('/api/fees/concessions').set(as('accounts')).send({ assignmentId: fee.id, basis: 'percent', value: 10, method: 'Equal', remarks: 'Sibling in the school' }).expect(201);
      const total = Math.round(fee.gross / 10);
      expect(r.body).toMatchObject({ kind: 'CONCESSION', amount: total, remarks: 'Sibling in the school', createdByName: 'Kavitha Raman' });
      await load();
      expect(inv(1).concession).toBe(0); // already paid
      expect(fee.invoices.reduce((n, i) => n + i.concession, 0)).toBe(total);
      expect(fee.totals.concession).toBe(total);
    });

    it('replaces the earlier concession; order-wise fills the first unpaid installment', async () => {
      await http.post('/api/fees/concessions').set(as('accounts')).send({ assignmentId: fee.id, basis: 'amount', value: 5000, method: 'Order Wise', remarks: 'Joined mid-year' }).expect(201);
      await load();
      expect(fee.invoices.map((i) => i.concession)).toEqual([0, 5000, 0, 0]);
    });

    it('takes per-installment amounts by hand', async () => {
      await http.post('/api/fees/concessions').set(as('accounts')).send({ assignmentId: fee.id, basis: 'amount', value: 0, method: 'Manual', manual: { [inv(2).id]: 1000, [inv(4).id]: 3000 }, remarks: 'Management decision' }).expect(201);
      await load();
      expect(fee.invoices.map((i) => i.concession)).toEqual([0, 1000, 0, 3000]);
    });

    it('refuses more than is unpaid, amounts on a paid installment, and no reason', async () => {
      const big = await http.post('/api/fees/concessions').set(as('accounts')).send({ assignmentId: fee.id, basis: 'percent', value: 100, method: 'Equal', remarks: 'Full waiver' }).expect(400);
      expect(big.body.message).toContain('is more than the');
      await http.post('/api/fees/concessions').set(as('accounts')).send({ assignmentId: fee.id, basis: 'amount', value: 0, method: 'Manual', manual: { [inv(1).id]: 100 }, remarks: 'Paid one' }).expect(400);
      await http.post('/api/fees/concessions').set(as('accounts')).send({ assignmentId: fee.id, basis: 'amount', value: 100, method: 'Equal', remarks: '' }).expect(400);
      await http.post('/api/fees/concessions').set(as('teacher')).send({ assignmentId: fee.id, basis: 'amount', value: 100, method: 'Equal', remarks: 'Teacher' }).expect(403);
    });
  });

  it('waives the late fee on an overdue installment without a payment, once per day', async () => {
    const i3 = inv(3);
    if (!i3.lateFee) return; // only overdue after 5 Oct
    const r = await http.post('/api/fees/fine-waivers').set(as('accounts')).send({ invoiceId: i3.id, remarks: 'Parent was in hospital' }).expect(201);
    expect(r.body).toMatchObject({ kind: 'FINE_WAIVER', amount: i3.lateFee });
    await load();
    expect(inv(3).lateFee).toBe(0);
    const again = await http.post('/api/fees/fine-waivers').set(as('accounts')).send({ invoiceId: i3.id, remarks: 'Again' }).expect(400);
    expect(again.body.message).toContain('no late fee');
  });

  it('writes off the unpaid fee from the last installment back, in the existing wording', async () => {
    const amount = inv(4).balance + 2000;
    const r = await http.post('/api/fees/adjustments').set(as('accounts')).send({ assignmentId: fee.id, amount, remarks: 'T C taken' }).expect(201);
    expect(r.body.remarks).toBe(`The total adjustment amount ₹${amount.toLocaleString('en-IN')} out of a total amount of ₹${fee.gross.toLocaleString('en-IN')} (T C taken)`);
    const before = fee;
    await load();
    expect(inv(4).balance).toBe(0);
    expect(inv(3).adjustment).toBe(2000);
    expect(inv(3).balance).toBe(before.invoices[2].balance - 2000);
    await http.post('/api/fees/adjustments').set(as('accounts')).send({ assignmentId: fee.id, amount: 10_000_000, remarks: 'Too much' }).expect(400);
  });

  describe('refund', () => {
    it('pays back part of a receipt by cheque; the balance does not change', async () => {
      const balance = fee.totals.balance;
      await http.post('/api/fees/refunds').set(as('accounts')).send({ receiptId: receipt.id, amount: receipt.feeTotal + 1, mode: 'Cheque', instrumentNo: '445566', remarks: 'Left school' }).expect(400);
      await http.post('/api/fees/refunds').set(as('accounts')).send({ receiptId: receipt.id, amount: 1000, mode: 'Cheque', remarks: 'Left school' }).expect(400);
      const r = await http.post('/api/fees/refunds').set(as('accounts')).send({ receiptId: receipt.id, amount: 12500, mode: 'Cheque', bank: 'SBI', instrumentNo: '445566', remarks: 'Joined another school' }).expect(201);
      expect(r.body.refunds).toHaveLength(1);
      expect(r.body.refunds[0]).toMatchObject({ amount: 12500, mode: 'Cheque', instrumentNo: '445566', status: 'Completed', receiptNo: receipt.no });
      expect(r.body.refundable).toBe(receipt.feeTotal - 12500);
      await load();
      expect(fee.totals.balance).toBe(balance);
    });

    it('allows several refunds up to the fee on the receipt, then refuses; refunded receipts can’t be cancelled', async () => {
      const r = await http.post('/api/fees/refunds').set(as('accounts')).send({ receiptId: receipt.id, amount: receipt.feeTotal - 12500, mode: 'Cash', remarks: 'Rest of the refund' }).expect(201);
      expect(r.body.refundable).toBe(0);
      await http.post('/api/fees/refunds').set(as('accounts')).send({ receiptId: receipt.id, amount: 1, mode: 'Cash', remarks: 'More' }).expect(400);
      const c = await http.post(`/api/fees/receipts/${receipt.id}/cancel`).set(as('accounts')).send({ reason: 'Wrong' }).expect(400);
      expect(c.body.message).toContain('has refunds');
    });
  });

  describe('reports', () => {
    it('lists the student’s corrections, newest first', async () => {
      const r = await http.get(`/api/fees/students/${studentId}/corrections`).set(as('accounts')).expect(200);
      expect(r.body.map((c: { kind: string }) => c.kind).slice(0, 2)).toEqual(['ADJUSTMENT', expect.stringMatching(/FINE_WAIVER|CONCESSION/)]);
      await http.get(`/api/fees/students/${studentId}/corrections`).set(as('parent')).expect(403);
    });

    it('dues: who owes what, with the guardian to remind', async () => {
      const r = await http.get('/api/fees/reports/dues').set(as('accounts')).expect(200);
      const row = r.body.rows.find((x: { studentId: string }) => x.studentId === studentId);
      expect(row).toMatchObject({ balance: fee.totals.balance, guardian: { name: 'E2E Parent' } });
      expect(row.dues.length).toBeGreaterThan(0);
      await http.get('/api/fees/reports/dues').set(as('teacher')).expect(403);
    });

    it('class summary: billed, concession, write-off, collected net of refunds', async () => {
      const r = await http.get('/api/fees/reports/classes').set(as('accounts')).expect(200);
      const c6a = r.body.rows.find((x: { className: string }) => x.className === '6-A');
      expect(c6a.refunded).toBeGreaterThanOrEqual(receipt.feeTotal);
      expect(c6a.concession).toBeGreaterThanOrEqual(4000);
      expect(c6a.adjustment).toBeGreaterThan(0);
      expect(r.body.totals.billed).toBeGreaterThan(0);
    });

    it('corrections register: concessions, write-offs, waivers, refunds and cancellations for a date range', async () => {
      const r = await http.get(`/api/fees/reports/corrections?from=${today}&to=${today}`).set(as('accounts')).expect(200);
      const mine = r.body.corrections.filter((c: { studentId: string }) => c.studentId === studentId);
      expect(mine.filter((c: { kind: string }) => c.kind === 'CONCESSION')).toHaveLength(3);
      expect(r.body.refunds.filter((f: { studentId: string }) => f.studentId === studentId)).toHaveLength(2);
      const onlyRefunds = await http.get(`/api/fees/reports/corrections?from=${today}&to=${today}&kind=REFUND`).set(as('accounts')).expect(200);
      expect(onlyRefunds.body.corrections).toHaveLength(0);
      expect(onlyRefunds.body.totals.refund).toBeGreaterThanOrEqual(receipt.feeTotal);
    });
  });
});
