import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  INSTRUMENT_MODES,
  PAYMENT_MODES,
  RECON_MODES,
  type CollectableInvoice,
  type FineAction,
  type PaymentMode,
  type ReceiptDto,
  type ReceiptListItem,
  type ReconStatus,
} from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { inr } from './Fees';

const todayISO = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const RECON_TONE: Record<ReconStatus, 'gray' | 'amber' | 'green' | 'red'> = { NA: 'gray', PENDING: 'amber', DONE: 'green', FAILED: 'red' };
const RECON_LABEL: Record<ReconStatus, string> = { NA: '—', PENDING: 'Awaiting bank', DONE: 'Reconciled', FAILED: 'Failed' };

// ======================= counter collection =======================

interface LineState {
  on: boolean;
  fee: string;
  fine: FineAction;
}

/** Counter screen: find a student, pick installments (full or part), decide the late fee, choose the mode, collect. */
export function CollectPanel({ initialStudentId }: { initialStudentId?: string }) {
  const [studentId, setStudentId] = useState(initialStudentId ?? '');
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  return (
    <div className="space-y-4">
      <StudentFinder
        onPick={(id) => {
          setStudentId(id);
          setReceipt(null);
        }}
      />
      {receipt && <CollectedBanner r={receipt} onClose={() => setReceipt(null)} />}
      {studentId && <CollectForm key={studentId} studentId={studentId} onCollected={setReceipt} />}
    </div>
  );
}

function StudentFinder({ onPick }: { onPick: (id: string) => void }) {
  const { branchId } = useScope();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: ['collect-search', branchId, term], queryFn: () => api.students({ branchId, q: term, pageSize: 8 }), enabled: term.length >= 2 });
  return (
    <Card>
      <Field label="Find student" hint="Name, admission number or parent's mobile">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Aarav or BNMPS26-0033" />
      </Field>
      {term.length >= 2 && res.data && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {res.data.items.map((s) => (
            <li key={s.id}>
              <button
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-bg"
                onClick={() => {
                  onPick(s.id);
                  setQ('');
                }}
              >
                <b>{s.name}</b>
                <span className="font-mono text-xs">{s.admissionNo}</span>
                <span className="text-sm text-muted">
                  {s.className ?? 'No class'} · {s.branchName}
                  {s.primaryGuardian ? ` · ${s.primaryGuardian.name}` : ''}
                </span>
              </button>
            </li>
          ))}
          {!res.data.items.length && <li className="px-3 py-2 text-sm text-muted">No student found</li>}
        </ul>
      )}
    </Card>
  );
}

function CollectForm({ studentId, onCollected }: { studentId: string; onCollected: (r: ReceiptDto) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['collect', studentId], queryFn: () => api.collectView(studentId) });
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [extra, setExtra] = useState({ bank: '', instrumentNo: '', instrumentDate: todayISO(), reference: '', remarks: '', waiveReason: '' });

  // Start with the oldest installment ticked, in full, late fee collected.
  useEffect(() => {
    if (!q.data) return;
    setLines(Object.fromEntries(q.data.invoices.map((i, k) => [i.invoiceId, { on: k === 0, fee: String(i.balance), fine: 'pay' as FineAction }])));
  }, [q.data]);

  const chosen = useMemo(() => (q.data?.invoices ?? []).filter((i) => lines[i.invoiceId]?.on), [q.data, lines]);
  const fineOf = (i: CollectableInvoice) => (lines[i.invoiceId]?.fine === 'pay' ? i.lateFee : 0);
  const feeOf = (i: CollectableInvoice) => Math.max(0, Math.round(Number(lines[i.invoiceId]?.fee) || 0));
  const total = chosen.reduce((n, i) => n + feeOf(i) + fineOf(i), 0);
  const anyWaive = chosen.some((i) => i.lateFee > 0 && lines[i.invoiceId]?.fine === 'waive');

  const collect = useMutation({
    mutationFn: () =>
      api.collect({
        studentId,
        mode,
        lines: chosen.map((i) => ({ invoiceId: i.invoiceId, fee: feeOf(i), fine: lines[i.invoiceId].fine })),
        ...(INSTRUMENT_MODES.includes(mode) ? { bank: extra.bank, instrumentNo: extra.instrumentNo, instrumentDate: extra.instrumentDate } : {}),
        reference: INSTRUMENT_MODES.includes(mode) || mode === 'Cash' ? null : extra.reference || null,
        remarks: extra.remarks || null,
        waiveReason: anyWaive ? extra.waiveReason : null,
      }),
    onSuccess: (r) => {
      onCollected(r);
      setExtra({ ...extra, bank: '', instrumentNo: '', reference: '', remarks: '', waiveReason: '' });
      void qc.invalidateQueries({ queryKey: ['collect', studentId] });
      void qc.invalidateQueries({ queryKey: ['student-fees', studentId] });
      void qc.invalidateQueries({ queryKey: ['receipts'] });
      void qc.invalidateQueries({ queryKey: ['fee-overview'] });
    },
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const v = q.data;
  const set = (id: string, p: Partial<LineState>) => setLines({ ...lines, [id]: { ...lines[id], ...p } });

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {v.name} <span className="font-mono text-sm font-normal">{v.admissionNo}</span>
          <span className="text-sm font-normal text-muted">
            {v.className ?? 'No class'} · {v.branchName}
          </span>
        </span>
      }
      actions={
        <Link to={`/students/${v.studentId}`} className="text-sm">
          Profile →
        </Link>
      }
    >
      {v.unconfirmed > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          {v.unconfirmed} assigned fee(s) are not confirmed yet, so they can't be collected. Confirm them under Assign &amp; publish.
        </p>
      )}
      {!v.invoices.length ? (
        <p className="py-6 text-center text-muted">Nothing due 🎉</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            collect.mutate();
          }}
          className="space-y-4"
        >
          <Table
            rows={v.invoices}
            rowKey={(i) => i.invoiceId}
            columns={[
              {
                header: '',
                cell: (i) => <input type="checkbox" aria-label={`Collect ${i.label}`} checked={!!lines[i.invoiceId]?.on} onChange={(e) => set(i.invoiceId, { on: e.target.checked })} />,
              },
              {
                header: 'Installment',
                cell: (i) => (
                  <span>
                    {i.feeTypeName} · {i.label}
                    <span className="block text-xs text-muted">{i.academicYear}</span>
                  </span>
                ),
              },
              { header: 'Due', cell: (i) => <span className={i.daysLate ? 'text-red-700' : ''}>{i.dueDate}</span> },
              { header: 'Balance', cell: (i) => inr(i.balance), className: 'text-right' },
              {
                header: 'Paying now',
                cell: (i) => (
                  <Input
                    type="number"
                    min={0}
                    max={i.balance}
                    disabled={!lines[i.invoiceId]?.on}
                    value={lines[i.invoiceId]?.fee ?? ''}
                    onChange={(e) => set(i.invoiceId, { fee: e.target.value })}
                    className="w-28! text-right"
                    aria-label={`Amount for ${i.label}`}
                  />
                ),
              },
              {
                header: `Late fee (₹${v.lateFeePerDay}/day)`,
                cell: (i) =>
                  i.lateFee > 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="whitespace-nowrap">
                        {inr(i.lateFee)} <span className="text-xs text-muted">({i.daysLate}d)</span>
                      </span>
                      <select
                        aria-label={`Late fee for ${i.label}`}
                        disabled={!lines[i.invoiceId]?.on}
                        value={lines[i.invoiceId]?.fine ?? 'pay'}
                        onChange={(e) => set(i.invoiceId, { fine: e.target.value as FineAction })}
                        className="rounded-md border border-line bg-white px-1.5 py-1 text-sm"
                      >
                        <option value="pay">Collect</option>
                        <option value="waive">Waive</option>
                        <option value="defer">Later</option>
                      </select>
                    </span>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Payment mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} options={PAYMENT_MODES.map((m): [string, string] => [m, m])} />
            </Field>
            {INSTRUMENT_MODES.includes(mode) ? (
              <>
                <Field label="Bank">
                  <Input required value={extra.bank} onChange={(e) => setExtra({ ...extra, bank: e.target.value })} />
                </Field>
                <Field label={`${mode} number`}>
                  <Input required value={extra.instrumentNo} onChange={(e) => setExtra({ ...extra, instrumentNo: e.target.value })} />
                </Field>
                <Field label={`${mode} date`}>
                  <Input type="date" required max={v.today} value={extra.instrumentDate} onChange={(e) => setExtra({ ...extra, instrumentDate: e.target.value })} />
                </Field>
              </>
            ) : (
              mode !== 'Cash' && (
                <Field label="Transaction ref / UTR">
                  <Input value={extra.reference} onChange={(e) => setExtra({ ...extra, reference: e.target.value })} />
                </Field>
              )
            )}
            {anyWaive && (
              <Field label="Reason for waiving the late fee" className="sm:col-span-2">
                <Input required minLength={3} value={extra.waiveReason} onChange={(e) => setExtra({ ...extra, waiveReason: e.target.value })} />
              </Field>
            )}
            <Field label="Remarks (optional)" className="sm:col-span-2">
              <Input value={extra.remarks} onChange={(e) => setExtra({ ...extra, remarks: e.target.value })} />
            </Field>
          </div>
          {RECON_MODES.includes(mode) && <p className="text-sm text-muted">{mode} receipts are marked “Awaiting bank” until you reconcile them with the bank statement.</p>}

          <ErrorBox error={collect.error} />
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
            <span className="text-lg">
              Total <b>{inr(total)}</b>
            </span>
            <Button type="submit" variant="primary" disabled={!chosen.length || total <= 0 || collect.isPending}>
              {collect.isPending ? 'Saving…' : `Collect ${inr(total)}`}
            </Button>
          </div>
        </form>
      )}

      {v.receipts.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-muted">Receipts</h3>
          <ReceiptTable rows={v.receipts} compact />
        </div>
      )}
    </Card>
  );
}

function CollectedBanner({ r, onClose }: { r: ReceiptDto; onClose: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-green-900">
      <span>
        ✅ Receipt <b className="font-mono">{r.no}</b> issued for <b>{inr(r.total)}</b> ({r.mode}) to {r.studentName}.
      </span>
      <Link to={`/receipts/${r.id}`} className="font-semibold">
        Open &amp; print →
      </Link>
      <button className="ml-auto text-sm text-green-800" onClick={onClose} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

// ======================= receipt register =======================

export function ReceiptRegister() {
  const { branchId, isTenantWide } = useScope();
  const today = todayISO();
  const [f, setF] = useState({ from: today, to: today, mode: '', recon: '' });
  const q = useQuery({ queryKey: ['receipts', branchId, f], queryFn: () => api.receiptRegister({ branchId, ...f }) });
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="From">
            <Input type="date" value={f.from} max={today} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} />
          </Field>
          <Field label="To">
            <Input type="date" value={f.to} min={f.from} max={today} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
          <Field label="Mode">
            <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={[['', 'All modes'], ...PAYMENT_MODES.map((m): [string, string] => [m, m])]} />
          </Field>
          <Field label="Reconciliation">
            <Select
              value={f.recon}
              onChange={(e) => setF({ ...f, recon: e.target.value })}
              options={[
                ['', 'All'],
                ['PENDING', 'Awaiting bank'],
                ['DONE', 'Reconciled'],
                ['FAILED', 'Failed'],
              ]}
            />
          </Field>
        </div>
      </Card>
      {q.isLoading ? (
        <Loading />
      ) : !q.data ? (
        <ErrorBox error={q.error} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Collected" value={inr(q.data.totals.total)} sub={`${q.data.totals.count} receipt(s)${q.data.cancelled ? ` · ${q.data.cancelled} cancelled` : ''}`} />
            <Stat label="Fees" value={inr(q.data.totals.fee)} />
            <Stat label="Late fees" value={inr(q.data.totals.fine)} />
            <Stat label="By mode" value={q.data.totals.byMode.length ? '' : '—'} sub={q.data.totals.byMode.map((m) => `${m.mode} ${inr(m.total)}`).join(' · ')} />
          </div>
          <Card>
            <ReceiptTable rows={q.data.rows} showBranch={isTenantWide && !branchId} />
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-3">
      <div className="text-xs font-semibold text-muted uppercase">{label}</div>
      {value && <div className="text-xl font-bold">{value}</div>}
      {sub && <div className="text-sm text-muted">{sub}</div>}
    </div>
  );
}

export function ReceiptTable({ rows, compact, showBranch }: { rows: ReceiptListItem[]; compact?: boolean; showBranch?: boolean }) {
  const nav = useNavigate();
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={(r) => nav(`/receipts/${r.id}`)}
      empty="No receipts"
      columns={[
        { header: 'Receipt', cell: (r) => <span className={`font-mono ${r.status === 'CANCELLED' ? 'line-through text-muted' : ''}`}>{r.no}</span> },
        { header: 'Date', cell: (r) => r.date },
        ...(compact
          ? []
          : [
              {
                header: 'Student',
                cell: (r: ReceiptListItem) => (
                  <span>
                    {r.studentName} <span className="text-xs text-muted">{r.className}</span>
                  </span>
                ),
              },
            ]),
        ...(showBranch ? [{ header: 'Branch', cell: (r: ReceiptListItem) => r.branchName }] : []),
        { header: 'Mode', cell: (r) => r.mode },
        { header: 'Amount', cell: (r) => inr(r.total), className: 'text-right' },
        {
          header: 'Status',
          cell: (r) =>
            r.status === 'CANCELLED' ? (
              <Badge tone="red">{r.recon === 'FAILED' ? 'Bounced' : 'Cancelled'}</Badge>
            ) : r.recon !== 'NA' ? (
              <Badge tone={RECON_TONE[r.recon]}>{RECON_LABEL[r.recon]}</Badge>
            ) : (
              <Badge tone="green">Paid</Badge>
            ),
        },
        ...(compact ? [] : [{ header: 'By', cell: (r: ReceiptListItem) => <span className="text-muted">{r.createdByName}</span> }]),
      ]}
    />
  );
}

/** A student's receipts (student profile and the parent's Fees page). */
export function StudentReceipts({ studentId }: { studentId: string }) {
  const q = useQuery({ queryKey: ['receipts', 'student', studentId], queryFn: () => api.studentReceipts(studentId) });
  if (!q.data?.length) return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <b className="mb-2 block text-sm">Receipts</b>
      <ReceiptTable rows={q.data} compact />
    </div>
  );
}

// ======================= printable receipt =======================

export function ReceiptPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => api.receipt(id) });
  const staff = user?.role === 'accounts' || user?.role === 'manager';
  const done = (r: ReceiptDto) => {
    qc.setQueryData(['receipt', id], r);
    void qc.invalidateQueries({ queryKey: ['receipts'] });
    void qc.invalidateQueries({ queryKey: ['collect', r.studentId] });
    void qc.invalidateQueries({ queryKey: ['student-fees', r.studentId] });
  };
  const cancel = useMutation({ mutationFn: (reason: string) => api.cancelReceipt(id, reason), onSuccess: done });
  const recon = useMutation({ mutationFn: (ok: boolean) => api.reconcileReceipt(id, ok), onSuccess: done });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  const cancelled = r.status === 'CANCELLED';

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={`Receipt ${r.no}`}
          actions={
            <>
              <Button onClick={() => history.back()}>‹ Back</Button>
              <Button variant="primary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        />
        {staff && r.status === 'SUCCESS' && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {r.recon === 'PENDING' && (
              <>
                <span className="text-sm text-muted">Bank confirmation:</span>
                <Button onClick={() => recon.mutate(true)} disabled={recon.isPending}>
                  ✓ Money received
                </Button>
                <Button onClick={() => confirm(`Mark ${r.no} as failed (${r.mode === 'Cheque' ? 'bounced' : 'not credited'})? This cancels the receipt and puts the balance back.`) && recon.mutate(false)} disabled={recon.isPending}>
                  ✕ {r.mode === 'Cheque' ? 'Bounced' : 'Not credited'}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              className="ml-auto text-red-700"
              disabled={cancel.isPending}
              onClick={() => {
                const reason = prompt(`Cancel receipt ${r.no}? The amounts go back onto the installments. Reason:`);
                if (reason) cancel.mutate(reason);
              }}
            >
              Cancel receipt
            </Button>
          </div>
        )}
        <ErrorBox error={cancel.error ?? recon.error} />
      </div>

      <article className="relative mx-auto max-w-3xl rounded-card border border-line bg-white p-6 print:border-0 print:p-0">
        {cancelled && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="rotate-[-20deg] rounded-lg border-4 border-red-500 px-6 py-2 text-5xl font-black text-red-500/60">CANCELLED</span>
          </div>
        )}
        <header className="mb-4 flex items-start gap-4 border-b border-line pb-4">
          <img src="/bnm-logo.png" alt="" className="h-14" />
          <div className="ml-auto text-right text-sm">
            <div className="font-bold">{r.branchName}</div>
            {r.trust && <div className="text-muted">{r.trust}</div>}
            {r.branchAddress && <div className="text-muted">{r.branchAddress}</div>}
          </div>
        </header>
        <h2 className="mb-3 text-center text-lg font-bold tracking-wide uppercase">Fee receipt</h2>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-muted">Receipt no.</dt>
          <dd className="font-mono font-semibold">{r.no}</dd>
          <dt className="text-muted">Date</dt>
          <dd>{r.date}</dd>
          <dt className="text-muted">Student</dt>
          <dd className="font-semibold">{r.studentName}</dd>
          <dt className="text-muted">Admission no.</dt>
          <dd className="font-mono">{r.admissionNo}</dd>
          <dt className="text-muted">Class</dt>
          <dd>{r.className ?? '—'}</dd>
          <dt className="text-muted">Academic year</dt>
          <dd>{r.academicYear}</dd>
        </dl>
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs text-muted uppercase">
              <th className="py-2">Particulars</th>
              <th className="py-2 text-right">Fee</th>
              <th className="py-2 text-right">Late fee</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.invoiceId} className="border-b border-line">
                <td className="py-2">
                  {l.label}
                  {l.fineWaived > 0 && <span className="block text-xs text-muted">Late fee {inr(l.fineWaived)} waived</span>}
                </td>
                <td className="py-2 text-right">{inr(l.fee)}</td>
                <td className="py-2 text-right">{l.fine ? inr(l.fine) : '—'}</td>
                <td className="py-2 text-right">{inr(l.fee + l.fine)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="py-2" colSpan={3}>
                Total
              </td>
              <td className="py-2 text-right">{inr(r.total)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mb-4 text-sm italic">{r.amountInWords}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Paid by</dt>
          <dd>
            {r.mode}
            {r.bank && ` · ${r.bank}`}
            {r.instrumentNo && ` · No. ${r.instrumentNo}`}
            {r.instrumentDate && ` · dated ${r.instrumentDate}`}
            {r.reference && ` · Ref ${r.reference}`}
            {r.recon === 'PENDING' && <span className="text-muted"> (subject to realisation)</span>}
          </dd>
          {r.remarks && (
            <>
              <dt className="text-muted">Remarks</dt>
              <dd>{r.remarks}</dd>
            </>
          )}
          {cancelled && (
            <>
              <dt className="text-red-700">Cancelled</dt>
              <dd className="text-red-700">
                {r.cancelledAt?.slice(0, 10)} — {r.cancelReason}
              </dd>
            </>
          )}
        </dl>
        <footer className="mt-8 flex items-end justify-between text-xs text-muted">
          <span>
            Received by {r.createdByName} · {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          <span>Computer-generated receipt; no signature required.</span>
        </footer>
      </article>
    </div>
  );
}
