/**
 * Sprint 7 end-to-end tests: online payments through the development gateway (success, declined,
 * waiting for the bank, repeated webhooks, bad signatures, amount mismatch, paid twice), the
 * receipt SMS, the online transactions report and overdue reminders.
 * Uses a test child added under the seeded parent (Suresh Menon) and removes it afterwards.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { FeeAssignmentDto } from '@sms/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { todayIST } from '../src/common/dates';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { DevGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const PASSWORD = process.env.SEED_PASSWORD as string;
const TAG = 'E2E7';
const sent: { phone: string; text: string }[] = [];
const captureSms: SmsSender = { send: async (phone, text) => void sent.push({ phone, text }) };
const uniq = String(Date.now()).slice(-6);

describe('Online payments and notifications (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let gateway: DevGateway;
  const t: Record<string, string> = {};
  const as = (who: string) => ({ authorization: `Bearer ${t[who]}` });
  let studentId: string;
  let feeTypeId: string;
  let fee: FeeAssignmentDto;
  const today = todayIST();

  const load = async () => {
    const r = await http.get(`/api/fees/students/${studentId}`).set(as('accounts')).expect(200);
    fee = r.body.assignments[0];
    return fee;
  };
  const inv = (n: number) => fee.invoices[n - 1];
  const start = (invoiceIds: string[], status = 201) => http.post('/api/payments/online').set(as('parent')).send({ studentId, invoiceIds }).expect(status);
  const webhook = (body: object, signature: string, status = 200) => http.post('/api/payments/webhook/dev').set('x-signature', signature).send(body).expect(status);
  const success = (orderId: string, amount: number) => gateway.sign({ orderId, status: 'SUCCESS', code: 0, message: 'SUCCESSFUL', amount, mode: 'UPI', txnId: `OWTEST${orderId.slice(-6)}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SMS_SENDER).useValue(captureSms).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    gateway = app.get(PAYMENT_GATEWAY);
    for (const [who, email] of Object.entries({ bm: 'anitha@bnmpschool.in', accounts: 'kavitha@bnmpschool.in' })) {
      t[who] = (await http.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    }
    await prisma.otpCode.deleteMany({ where: { phone: '+919800000001' } });
    await http.post('/api/auth/otp/request').send({ phone: '9800000001' }).expect(202);
    const code = sent.find((m) => m.phone === '+919800000001')!.text.match(/\d{6}/)![0];
    t.parent = (await http.post('/api/auth/otp/verify').send({ phone: '9800000001', code }).expect(200)).body.accessToken;

    // A third child for Suresh Menon (linked by his mobile number), with the school fee assigned, confirmed and published.
    const ps = (await prisma.branch.findFirstOrThrow({ where: { code: 'BNMPS' } })).id;
    const year = (await prisma.academicYear.findFirstOrThrow({ where: { current: true } })).id;
    const cls = await prisma.schoolClass.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, name: '6-A' } });
    feeTypeId = (await prisma.feeType.findFirstOrThrow({ where: { branchId: ps, academicYearId: year, kind: 'SCHOOL' } })).id;
    const s = await http
      .post('/api/students')
      .set(as('bm'))
      .send({ branchId: ps, classId: cls.id, name: `${TAG} Menon ${uniq}`, guardians: [{ name: 'Suresh Menon', phone: '9800000001', relation: 'Father', primary: true }] })
      .expect(201);
    studentId = s.body.id;
    for (const action of ['assign', 'confirm', 'publish']) await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId, studentIds: [studentId], action }).expect(200);
    await load();
  });

  afterAll(async () => {
    const sids = (await prisma.student.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((s) => s.id);
    await prisma.paymentAttempt.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeReceipt.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.feeAssignment.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: sids } } });
    await prisma.student.deleteMany({ where: { id: { in: sids } } });
    await app?.close();
  });

  it('is for parents, and only for fees with online payment switched on', async () => {
    await http.post('/api/payments/online').set(as('accounts')).send({ studentId, invoiceIds: [inv(1).id] }).expect(403);
    const off = await start([inv(1).id], 400);
    expect(off.body.message).toContain("can't be paid online yet");
    await http.post('/api/fees/actions').set(as('accounts')).send({ feeTypeId, studentIds: [studentId], action: 'online_on' }).expect(200);
  });

  it('prices whole installments with today’s late fee and sends the parent to the gateway', async () => {
    const r = await start([inv(1).id, inv(2).id]);
    expect(r.body.amount).toBe(inv(1).balance + inv(1).lateFee + inv(2).balance + inv(2).lateFee);
    expect(r.body.checkoutUrl).toContain(`/pay/dev/${r.body.orderId}`);
    const a = await http.get(`/api/payments/online/${r.body.orderId}`).set(as('parent')).expect(200);
    expect(a.body).toMatchObject({ status: 'INITIATED', amount: r.body.amount, gateway: 'dev' });
  });

  it('a declined payment changes nothing and issues no receipt', async () => {
    const r = await start([inv(1).id]);
    const d = await http.post(`/api/payments/dev/${r.body.orderId}/complete`).set(as('parent')).send({ outcome: 'declined', mode: 'Credit Card' }).expect(200);
    expect(d.body).toMatchObject({ status: 'FAILED', code: 1072, receiptId: null });
    await load();
    expect(inv(1).paid).toBe(0);
  });

  it('rejects webhooks with a bad signature', async () => {
    const r = await start([inv(1).id]);
    const { body } = success(r.body.orderId, r.body.amount);
    await webhook(body, 'not-the-signature', 401);
    await webhook({ ...body, amount: 1 }, success(r.body.orderId, r.body.amount).signature, 401);
  });

  it('waiting for the bank blocks a second attempt; the late success issues one receipt, however often it is repeated', async () => {
    const r = await start([inv(1).id]);
    const p = await http.post(`/api/payments/dev/${r.body.orderId}/complete`).set(as('parent')).send({ outcome: 'pending', mode: 'UPI' }).expect(200);
    expect(p.body).toMatchObject({ status: 'PENDING', code: 1006 });
    const blocked = await start([inv(2).id], 409);
    expect(blocked.body.message).toContain('still waiting for the bank');

    sent.length = 0;
    const { body, signature } = success(r.body.orderId, r.body.amount);
    await webhook(body, signature);
    await webhook(body, signature); // gateways repeat themselves
    const a = await http.get(`/api/payments/online/${r.body.orderId}`).set(as('parent')).expect(200);
    expect(a.body).toMatchObject({ status: 'SUCCESS', code: 0, excess: 0 });
    expect(a.body.receiptNo).toMatch(/^BNMPS\/2026-27\/\d{4}$/);
    const receipts = await prisma.feeReceipt.findMany({ where: { studentId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ source: 'Online', mode: 'UPI', total: r.body.amount, createdByName: 'Suresh Menon (online)' });
    await load();
    expect(inv(1).balance).toBe(0);
    // The parent gets a receipt SMS, once.
    const sms = sent.filter((m) => m.phone === '+919800000001' && m.text.includes(a.body.receiptNo));
    expect(sms).toHaveLength(1);
  });

  it('money paid twice (counter meanwhile) is kept as excess for Accounts to refund', async () => {
    const r = await start([inv(2).id]);
    await http.post('/api/fees/receipts').set(as('accounts')).send({ studentId, mode: 'Cash', lines: [{ invoiceId: inv(2).id, fee: inv(2).balance, fine: 'pay' }] }).expect(201);
    const { body, signature } = success(r.body.orderId, r.body.amount);
    await webhook(body, signature);
    const a = await http.get(`/api/payments/online/${r.body.orderId}`).set(as('accounts')).expect(200);
    expect(a.body).toMatchObject({ status: 'SUCCESS', excess: r.body.amount, receiptId: null });
  });

  it('an amount that does not match the order is not accepted as paid', async () => {
    await load();
    const r = await start([inv(3).id]);
    const { body, signature } = success(r.body.orderId, r.body.amount + 1);
    await webhook(body, signature);
    const a = await http.get(`/api/payments/online/${r.body.orderId}`).set(as('parent')).expect(200);
    expect(a.body.status).toBe('FAILED');
    expect(a.body.message).toContain('Amount mismatch');
  });

  it('online transactions report for accounts', async () => {
    const r = await http.get(`/api/payments/online?from=${today}`).set(as('accounts')).expect(200);
    const mine = r.body.rows.filter((x: { studentId: string }) => x.studentId === studentId);
    expect(mine.length).toBeGreaterThanOrEqual(6);
    expect(r.body.totals.success).toBeGreaterThanOrEqual(2);
    expect(r.body.totals.excess).toBeGreaterThan(0);
    await http.get(`/api/payments/online?from=${today}`).set(as('parent')).expect(403);
  });

  it('sends overdue reminders once per student per day', async () => {
    const first = await http.post('/api/fees/reminders').set(as('accounts')).send({}).expect(200);
    expect(first.body.sent + first.body.skipped).toBeGreaterThan(0);
    const again = await http.post('/api/fees/reminders').set(as('accounts')).send({}).expect(200);
    expect(again.body.sent).toBe(0);
    await http.post('/api/fees/reminders').set(as('parent')).send({}).expect(403);
  });
});
