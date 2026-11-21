/**
 * Sprint 5 end-to-end tests: counter collection, part payments, late fee (collect / waive / defer),
 * cheque details and reconciliation, receipt numbering, cancellation and the receipt register.
 * Works on its own test student and removes it afterwards.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { lateFee, type CollectDto, type ReceiptDto } from '@sms/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { addDays, todayIST } from '../src/common/dates';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E5';
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };
const uniq = String(Date.now()).slice(-6);

describe('Fee collection (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const t: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });
  let studentId: string;
  let view: CollectDto;
  const receipts: ReceiptDto[] = [];
  const today = todayIST();

  const load = async () => (view = (await http.get(`/api/fees/collect/${studentId}`).set(as('accounts')).expect(200)).body);
  const inv = (i: number) => view.invoices.find((x) => x.label === `Installment ${i}`)!;
  const collect = async (body: object, status = 201) => {
    const r = await http.post('/api/fees/receipts').set(as('accounts')).send({ studentId, ...body }).expect(status);
    if (status === 201) receipts.push(r.body);
    return r.body;
  };

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

    // A fresh Class 6-A student with the school fee assigned and confirmed.
    const ps = (await prisma.branch.findFirstOrThrow({ where: { code: 'BNMPS' } })).id;
    const year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
    const cls = await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '6-A' } });
    const feeType = await prisma.feeType.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, kind: 'SCHOOL' } });
    const s = await http
      .post('/api/students')
      .set(as('bm'))
      .send({ branchId: ps, classId: cls.id, name: `${TAG} Collect ${uniq}`, guardians: [{ name: 'E2E Parent', phone: `+9190${uniq}01`, relation: 'Father', primary: true }] })
      .expect(201);
    studentId = s.body.id;
    for (const action of ['assign', 'confirm']) {
      const r = await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId: feeType.id, studentIds: [studentId], action }).expect(200);
      expect(r.body.done).toBe(1);
    }
    await load();
  });

  afterAll(async () => {
    const sids = (await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((s) => s.id);
    await prisma.feeReceipt.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeAssignment.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.student.deleteMany({ where: { id: { in: sids } } });
    await prisma.user.deleteMany({ where: { phone: { startsWith: '+9190' }, children: { none: {} } } });
    await app?.close();
  });

  it('shows the installments with today’s late fee; only accounts and managers can collect', async () => {
    expect(view.invoices).toHaveLength(4);
    expect(view.lateFeePerDay).toBe(25);
    const i1 = inv(1);
    expect(i1.lateFee).toBe(lateFee({ balance: i1.balance, dueDate: i1.dueDate, fineFrom: null }, today, 25));
    await http.get(`/api/fees/collect/${studentId}`).set(as('teacher')).expect(403);
    await http.get(`/api/fees/collect/${studentId}`).set(as('parent')).expect(403);
    await http.post('/api/fees/receipts').set(as('parent')).send({ studentId, mode: 'Cash', lines: [{ invoiceId: i1.invoiceId, fee: 1, fine: 'defer' }] }).expect(403);
  });

  it('collects an installment with its late fee and issues a numbered receipt', async () => {
    const i1 = inv(1);
    const r = await collect({ mode: 'Cash', lines: [{ invoiceId: i1.invoiceId, fee: i1.balance, fine: 'pay' }] });
    expect(r.no).toMatch(/^BNMPS\/2026-27\/\d{4}$/);
    expect(r).toMatchObject({ status: 'SUCCESS', recon: 'NA', feeTotal: i1.balance, fineTotal: i1.lateFee, total: i1.balance + i1.lateFee, createdByName: 'Kavitha Raman' });
    expect(r.amountInWords).toMatch(/^Rupees .* Only$/);
    await load();
    expect(inv(1)).toBeUndefined(); // fully paid, no longer listed
  });

  it('takes a part payment and keeps the late fee running on the balance', async () => {
    const i2 = inv(2);
    const r = await collect({ mode: 'UPI', reference: 'UTR123456', lines: [{ invoiceId: i2.invoiceId, fee: 10000, fine: 'defer' }] });
    expect(r).toMatchObject({ feeTotal: 10000, fineTotal: 0, total: 10000 });
    expect(Number(r.no.slice(-4))).toBe(Number(receipts[0].no.slice(-4)) + 1);
    await load();
    expect(inv(2)).toMatchObject({ paid: 10000, balance: i2.balance - 10000, lateFee: i2.lateFee });
  });

  it('refuses to clear an installment while leaving its late fee, overpayments, and waivers without a reason', async () => {
    const i2 = inv(2);
    if (i2.lateFee > 0) {
      const e = await collect({ mode: 'Cash', lines: [{ invoiceId: i2.invoiceId, fee: i2.balance, fine: 'defer' }] }, 400);
      expect(e.message).toContain('collect or waive');
      const w = await collect({ mode: 'Cash', lines: [{ invoiceId: i2.invoiceId, fee: i2.balance, fine: 'waive' }] }, 400);
      expect(w.message).toBe('Give a reason for waiving the late fee');
    }
    const o = await collect({ mode: 'Cash', lines: [{ invoiceId: i2.invoiceId, fee: i2.balance + 1, fine: 'pay' }] }, 400);
    expect(o.message).toContain('is more than the');
    await collect({ mode: 'Cash', lines: [{ invoiceId: i2.invoiceId, fee: 0, fine: 'defer' }] }, 400);
  });

  it('waives the late fee with a reason when clearing the balance', async () => {
    const i2 = inv(2);
    const r = await collect({ mode: 'Cash', waiveReason: 'Medical emergency', lines: [{ invoiceId: i2.invoiceId, fee: i2.balance, fine: 'waive' }] });
    expect(r.fineTotal).toBe(0);
    expect(r.lines[0].fineWaived).toBe(i2.lateFee);
    if (i2.lateFee) expect(r.remarks).toContain('waived: Medical emergency');
  });

  it('needs cheque details, refuses post-dated cheques, and holds cheques for reconciliation', async () => {
    const i3 = inv(3);
    const line = [{ invoiceId: i3.invoiceId, fee: 5000, fine: 'defer' }];
    expect((await collect({ mode: 'Cheque', lines: line }, 400)).message).toContain('enter the bank');
    expect((await collect({ mode: 'Cheque', bank: 'SBI', instrumentNo: '123456', instrumentDate: addDays(today, 3), lines: line }, 400)).message).toContain('post-dated');
    const r = await collect({ mode: 'Cheque', bank: 'SBI', instrumentNo: '123456', instrumentDate: today, lines: line });
    expect(r).toMatchObject({ recon: 'PENDING', bank: 'SBI', instrumentNo: '123456', instrumentDate: today });
  });

  it('lists the day’s receipts with totals by mode', async () => {
    const reg = await http.get(`/api/fees/receipts?from=${today}`).set(as('accounts')).expect(200);
    const mine = reg.body.rows.filter((r: { studentId: string }) => r.studentId === studentId);
    expect(mine).toHaveLength(4);
    expect(reg.body.totals.byMode.map((m: { mode: string }) => m.mode)).toEqual(expect.arrayContaining(['Cash', 'UPI', 'Cheque']));
    await http.get('/api/fees/receipts?from=2026-12-01&to=2026-11-01').set(as('accounts')).expect(400);
  });

  it('a bounced cheque cancels its receipt and restores the balance', async () => {
    const cheque = receipts[3];
    const r = await http.post(`/api/fees/receipts/${cheque.id}/recon`).set(as('accounts')).send({ ok: false }).expect(200);
    expect(r.body).toMatchObject({ status: 'CANCELLED', recon: 'FAILED' });
    expect(r.body.cancelReason).toContain('cheque bounced');
    await load();
    expect(inv(3).paid).toBe(0);
    await http.post(`/api/fees/receipts/${cheque.id}/recon`).set(as('accounts')).send({ ok: true }).expect(400);
  });

  it('cancels only the newest receipt on an installment, reversing it exactly', async () => {
    const [, part, waive] = receipts;
    const e = await http.post(`/api/fees/receipts/${part.id}/cancel`).set(as('accounts')).send({ reason: 'Wrong student' }).expect(400);
    expect(e.body.message).toContain(`Receipt ${waive.no} was issued later`);
    await http.post(`/api/fees/receipts/${waive.id}/cancel`).set(as('accounts')).send({ reason: 'x' }).expect(400);
    await http.post(`/api/fees/receipts/${waive.id}/cancel`).set(as('accounts')).send({ reason: 'Entered twice' }).expect(200);
    await http.post(`/api/fees/receipts/${part.id}/cancel`).set(as('bm')).send({ reason: 'Wrong student' }).expect(200);
    await http.post(`/api/fees/receipts/${part.id}/cancel`).set(as('bm')).send({ reason: 'Again' }).expect(400);
    const row = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: waive.lines[0].invoiceId } });
    expect(row).toMatchObject({ paid: 0, finePaid: 0, fineWaived: 0, fineFrom: null });
  });

  it('keeps receipts private: parents only see their own children’s, teachers none', async () => {
    await http.get(`/api/fees/receipts/${receipts[0].id}`).set(as('parent')).expect(404);
    await http.get(`/api/fees/students/${studentId}/receipts`).set(as('parent')).expect(404);
    await http.get(`/api/fees/receipts/${receipts[0].id}`).set(as('teacher')).expect(403);
    const list = await http.get(`/api/fees/students/${studentId}/receipts`).set(as('accounts')).expect(200);
    expect(list.body.map((r: { status: string }) => r.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED', 'SUCCESS']);
  });
});
