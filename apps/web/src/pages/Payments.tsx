import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ONLINE_MODES, PAYMENT_STATUS_LABEL, type DevOutcome, type PaymentStatus, type StudentFeesDto } from '@sms/shared';
import { api } from '../lib/api';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { inr } from './Fees';

const todayISO = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const STATUS_TONE: Record<PaymentStatus, 'gray' | 'amber' | 'green' | 'red'> = { INITIATED: 'gray', PENDING: 'amber', SUCCESS: 'green', FAILED: 'red' };

// ======================= parent: pay online =======================

/** Parent's "Pay online": tick whole installments (balance + today's late fee) of fees with online payment on. */
export function PayOnline({ f }: { f: StudentFeesDto }) {
  const nav = useNavigate();
  const payable = f.assignments.filter((a) => a.onlineEnabled).flatMap((a) => a.invoices.filter((i) => i.balance > 0).map((i) => ({ ...i, feeTypeName: a.feeTypeName })));
  const today = todayISO();
  // Tick everything due by today (or the next installment when nothing is due yet).
  const [chosen, setChosen] = useState<Set<string>>(() => {
    const due = payable.filter((i) => i.dueDate <= today);
    return new Set((due.length ? due : payable.slice(0, 1)).map((i) => i.id));
  });
  const total = payable.filter((i) => chosen.has(i.id)).reduce((n, i) => n + i.balance + i.lateFee, 0);
  const start = useMutation({
    mutationFn: () => api.startPayment(f.studentId, [...chosen]),
    onSuccess: (r) => {
      // The development gateway lives inside this app; a real gateway is an external page.
      if (r.gateway === 'dev') nav(new URL(r.checkoutUrl, location.origin).pathname);
      else location.href = r.checkoutUrl;
    },
  });
  if (!payable.length) return null;
  return (
    <div className="rounded-lg border border-brand/40 bg-orange-50/40 p-3">
      <b className="mb-2 block">Pay online</b>
      <ul className="mb-3 space-y-1.5">
        {payable.map((i) => (
          <li key={i.id}>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(i.id)}
                onChange={(e) => {
                  const n = new Set(chosen);
                  if (e.target.checked) n.add(i.id);
                  else n.delete(i.id);
                  setChosen(n);
                }}
              />
              <span>
                {i.feeTypeName} · {i.label} <span className="text-muted">(due {i.dueDate})</span>
              </span>
              <b className="ml-auto">{inr(i.balance)}</b>
              {i.lateFee > 0 && <span className="text-red-700">+ late fee {inr(i.lateFee)}</span>}
            </label>
          </li>
        ))}
      </ul>
      <ErrorBox error={start.error} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-xs text-muted">UPI, cards or net banking. The receipt arrives by SMS.</span>
        <Button variant="primary" disabled={!chosen.size || start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : `Pay ${inr(total)} online`}
        </Button>
      </div>
    </div>
  );
}

// ======================= development gateway checkout =======================

export function DevCheckout() {
  const { orderId = '' } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['payment', orderId], queryFn: () => api.payment(orderId) });
  const [mode, setMode] = useState<string>('UPI');
  const done = useMutation({ mutationFn: (o: DevOutcome) => api.devCompletePayment(orderId, o, mode), onSuccess: () => nav(`/pay/result/${encodeURIComponent(orderId)}`, { replace: true }) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const a = q.data;
  return (
    <div className="mx-auto max-w-lg">
      <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        🧪 <b>Development payment gateway.</b> No money moves. Choose what the bank answers; a real gateway (not chosen yet) replaces this page.
      </p>
      <Card title={`Pay ${inr(a.amount)}`}>
        <p className="mb-2 text-sm text-muted">
          Order <span className="font-mono">{a.orderId}</span> · {a.studentName} ({a.className})
        </p>
        <ul className="mb-4 divide-y divide-line text-sm">
          {a.lines.map((l) => (
            <li key={l.invoiceId} className="flex justify-between py-1.5">
              <span>{l.label}</span>
              <span>
                {inr(l.fee)}
                {l.fine > 0 && <span className="text-red-700"> + {inr(l.fine)} late fee</span>}
              </span>
            </li>
          ))}
        </ul>
        {a.status !== 'INITIATED' && a.status !== 'PENDING' ? (
          <p className="text-sm">
            This order is already {PAYMENT_STATUS_LABEL[a.status].toLowerCase()}. <Link to={`/pay/result/${encodeURIComponent(orderId)}`}>See the result →</Link>
          </p>
        ) : (
          <>
            <Field label="Pay with">
              <Select value={mode} onChange={(e) => setMode(e.target.value)} options={ONLINE_MODES.map((m): [string, string] => [m, m])} />
            </Field>
            <ErrorBox error={done.error} />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button variant="primary" disabled={done.isPending} onClick={() => done.mutate('success')}>
                ✓ Pay {inr(a.amount)}
              </Button>
              <Button disabled={done.isPending} onClick={() => done.mutate('declined')}>
                Bank declines
              </Button>
              <Button disabled={done.isPending} onClick={() => done.mutate('pending')}>
                Bank is slow (pending)
              </Button>
              <Button disabled={done.isPending} onClick={() => nav('/fees')}>
                Cancel (leave the page)
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** Where the gateway sends the parent back: the order's outcome and, when paid, the receipt. */
export function PaymentResult() {
  const { orderId = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payment', orderId],
    queryFn: () => api.payment(orderId),
    // Keep checking while the bank hasn't answered.
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' || query.state.data?.status === 'INITIATED' ? 5000 : false),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const a = q.data;
  if (a.status === 'SUCCESS') void qc.invalidateQueries({ queryKey: ['student-fees', a.studentId] });
  const msg: Record<PaymentStatus, string> = {
    SUCCESS: `Payment of ${inr(a.amount)} received. Thank you!`,
    FAILED: `The payment did not go through${a.message ? ` (${a.message})` : ''}. No money was taken; you can try again.`,
    PENDING: 'Your bank has not confirmed the payment yet. This page updates by itself; you can also check back later. Please don’t pay again meanwhile.',
    INITIATED: 'The payment was not completed.',
  };
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Online payment" />
      <Card>
        <p className="mb-3 text-lg">
          <Badge tone={STATUS_TONE[a.status]}>{PAYMENT_STATUS_LABEL[a.status]}</Badge> {msg[a.status]}
        </p>
        <p className="text-sm text-muted">
          {a.studentName} · order <span className="font-mono">{a.orderId}</span>
          {a.gatewayTxnId && (
            <>
              {' '}
              · transaction <span className="font-mono">{a.gatewayTxnId}</span>
            </>
          )}
        </p>
        {a.excess > 0 && <p className="mt-2 text-sm text-amber-800">{inr(a.excess)} of this was already paid; the school office will refund it.</p>}
        <div className="mt-4 flex gap-2">
          {a.receiptId && (
            <Link to={`/receipts/${a.receiptId}`}>
              <Button variant="primary">Receipt {a.receiptNo}</Button>
            </Link>
          )}
          <Link to="/fees">
            <Button>Back to fees</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

// ======================= staff: online payments report =======================

export function OnlinePaymentsReport() {
  const { branchId, isTenantWide } = useScope();
  const today = todayISO();
  const [f, setF] = useState({ from: today, to: today, status: '' });
  const q = useQuery({ queryKey: ['online-payments', branchId, f], queryFn: () => api.onlinePayments({ branchId, ...f }) });
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From">
            <Input type="date" value={f.from} max={today} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} />
          </Field>
          <Field label="To">
            <Input type="date" value={f.to} min={f.from} max={today} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[['', 'All attempts'], ...(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s): [string, string] => [s, PAYMENT_STATUS_LABEL[s]])]} />
          </Field>
        </div>
      </Card>
      {q.isLoading ? (
        <Loading />
      ) : !q.data ? (
        <ErrorBox error={q.error} />
      ) : (
        <Card
          title={`${q.data.totals.attempts} attempt(s): ${q.data.totals.success} paid (${inr(q.data.totals.collected)}) · ${q.data.totals.failed} failed · ${q.data.totals.pending} waiting · ${q.data.totals.notCompleted} not completed`}
          actions={q.data.totals.excess > 0 ? <Badge tone="amber">{inr(q.data.totals.excess)} paid twice, to refund</Badge> : undefined}
        >
          <p className="mb-2 text-xs text-muted">Each attempt is listed, including retries and abandoned ones. Only “Paid” attempts produce a receipt.</p>
          <Table
            rows={q.data.rows}
            rowKey={(r) => r.id}
            empty="No online payments in this period"
            columns={[
              { header: 'Time', cell: (r) => new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) },
              { header: 'Order', cell: (r) => <span className="font-mono text-xs">{r.orderId}</span> },
              { header: 'Student', cell: (r) => `${r.studentName}${r.className ? ` (${r.className})` : ''}` },
              ...(isTenantWide && !branchId ? [{ header: 'Branch', cell: (r: (typeof q.data.rows)[number]) => r.branchName }] : []),
              { header: 'Amount', cell: (r) => inr(r.amount), className: 'text-right' },
              { header: 'Mode', cell: (r) => r.mode ?? '—' },
              {
                header: 'Status',
                cell: (r) => (
                  <span title={r.message ?? undefined}>
                    <Badge tone={STATUS_TONE[r.status]}>{PAYMENT_STATUS_LABEL[r.status]}</Badge>
                    {r.code != null && <span className="ml-1 text-xs text-muted">{r.code}</span>}
                  </span>
                ),
              },
              { header: 'Transaction', cell: (r) => <span className="font-mono text-xs">{r.gatewayTxnId ?? '—'}</span> },
              {
                header: 'Receipt',
                cell: (r) =>
                  r.receiptId ? (
                    <Link to={`/receipts/${r.receiptId}`} className="font-mono text-xs">
                      {r.receiptNo}
                    </Link>
                  ) : r.excess ? (
                    <span className="text-xs text-amber-800">{inr(r.excess)} to refund</span>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

/** "Send SMS reminders" on the Dues report. */
export function SendReminders({ count }: { count: number }) {
  const { branchId } = useScope();
  const m = useMutation({ mutationFn: () => api.sendReminders({ branchId }) });
  return (
    <span className="flex items-center gap-2">
      {m.data && (
        <span className="text-sm text-green-800">
          Sent {m.data.sent}
          {m.data.skipped ? ` · ${m.data.skipped} skipped (reminded today or no mobile)` : ''}
        </span>
      )}
      {m.error && <span className="text-sm text-red-700">{(m.error as Error).message}</span>}
      <Button disabled={!count || m.isPending} onClick={() => confirm(`Send an overdue-fee SMS to the parents of ${count} student(s)? Each parent gets at most one reminder a day.`) && m.mutate()}>
        {m.isPending ? 'Sending…' : 'Send SMS reminders'}
      </Button>
    </span>
  );
}
