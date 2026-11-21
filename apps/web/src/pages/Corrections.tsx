import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  CONCESSION_METHODS,
  CONCESSION_PRESETS,
  CORRECTION_LABEL,
  INSTRUMENT_MODES,
  PAYMENT_MODES,
  allocate,
  type ConcessionMethod,
  type FeeAssignmentDto,
  type FeeInvoiceDto,
  type PaymentMode,
  type ParallelStatus,
  type ReceiptDto,
} from '@sms/shared';
import { api } from '../lib/api';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Select, Table, Tabs } from '../components/ui';
import { inr } from './Fees';
import { SendReminders } from './Payments';

const todayISO = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Refreshes everything that shows a student's fees after a correction. */
function useRefreshFees() {
  const qc = useQueryClient();
  return (studentId: string) => {
    for (const k of [['student-fees', studentId], ['collect', studentId], ['corrections', studentId], ['receipts'], ['fee-overview'], ['fee-reports']]) void qc.invalidateQueries({ queryKey: k });
  };
}

function ReasonField({ value, onChange, presets }: { value: string; onChange: (v: string) => void; presets?: string[] }) {
  return (
    <Field label="Reason" hint="Shown on the reports with your name and the date">
      <Input required minLength={3} list={presets ? 'reason-presets' : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
      {presets && (
        <datalist id="reason-presets">
          {presets.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
    </Field>
  );
}

// ======================= concession =======================

export function ConcessionModal({ a, studentId, onClose }: { a: FeeAssignmentDto; studentId: string; onClose: () => void }) {
  const refresh = useRefreshFees();
  const current = a.totals.concession;
  const [basis, setBasis] = useState<'amount' | 'percent'>('amount');
  const [value, setValue] = useState(String(current || ''));
  const [method, setMethod] = useState<ConcessionMethod>('Equal');
  const [manual, setManual] = useState<Record<string, string>>(Object.fromEntries(a.invoices.map((i) => [i.id, String(i.concession || '')])));
  const [remarks, setRemarks] = useState('');
  // Unpaid room per installment once the current concession is taken off.
  const room = a.invoices.map((i) => Math.max(0, i.gross - i.adjustment - i.paid));
  const total = method === 'Manual' ? a.invoices.reduce((n, i) => n + (Number(manual[i.id]) || 0), 0) : basis === 'percent' ? Math.round((a.gross * (Number(value) || 0)) / 100) : Math.round(Number(value) || 0);
  const preview = useMemo(() => (method === 'Manual' ? a.invoices.map((i) => Number(manual[i.id]) || 0) : allocate(total, room, method)), [method, manual, total, a.invoices]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.setConcession({ assignmentId: a.id, basis, value: Number(value) || 0, method, manual: method === 'Manual' ? Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v) || 0])) : undefined, remarks }),
    onSuccess: () => (refresh(studentId), onClose()),
  });
  return (
    <Modal
      wide
      title={`Concession – ${a.feeTypeName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending || !preview || remarks.trim().length < 3} onClick={() => save.mutate()}>
            {total ? `Set concession ${inr(total)}` : 'Remove concession'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Annual fee {inr(a.gross)} · current concession {inr(current)}. The new amount replaces the current one and only reduces installments that are not paid yet.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="How to spread it">
          <Select value={method} onChange={(e) => setMethod(e.target.value as ConcessionMethod)} options={CONCESSION_METHODS.map((m): [string, string] => [m, m === 'Order Wise' ? 'Order wise (first installment first)' : m === 'Manual' ? 'Set each installment' : 'Equally'])} />
        </Field>
        {method !== 'Manual' && (
          <>
            <Field label="Enter as">
              <Select
                value={basis}
                onChange={(e) => setBasis(e.target.value as 'amount' | 'percent')}
                options={[
                  ['amount', 'Amount (₹)'],
                  ['percent', '% of annual fee'],
                ]}
              />
            </Field>
            <Field label={basis === 'percent' ? 'Percentage' : 'Amount (₹)'}>
              <Input type="number" min={0} max={basis === 'percent' ? 100 : undefined} value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      <Table
        rows={a.invoices}
        rowKey={(i) => i.id}
        columns={[
          { header: 'Installment', cell: (i) => i.label },
          { header: 'Amount', cell: (i) => inr(i.gross), className: 'text-right' },
          { header: 'Paid', cell: (i) => (i.paid ? inr(i.paid) : '—'), className: 'text-right' },
          {
            header: 'Concession',
            className: 'text-right',
            cell: (i: FeeInvoiceDto) => {
              const k = a.invoices.indexOf(i);
              return method === 'Manual' ? (
                <Input type="number" min={0} max={room[k]} disabled={!room[k]} value={manual[i.id]} onChange={(e) => setManual({ ...manual, [i.id]: e.target.value })} className="w-28! text-right" aria-label={`Concession on ${i.label}`} />
              ) : preview ? (
                inr(preview[k])
              ) : (
                '—'
              );
            },
          },
        ]}
      />
      {!preview && <p className="mt-2 text-sm text-red-700">That is more than the {inr(room.reduce((x, y) => x + y, 0))} still unpaid.</p>}
      <div className="mt-3">
        <ReasonField value={remarks} onChange={setRemarks} presets={CONCESSION_PRESETS} />
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

// ======================= write-off =======================

export function WriteOffModal({ a, studentId, onClose }: { a: FeeAssignmentDto; studentId: string; onClose: () => void }) {
  const refresh = useRefreshFees();
  const unpaid = a.totals.balance;
  const [amount, setAmount] = useState(String(unpaid));
  const [remarks, setRemarks] = useState('');
  const save = useMutation({ mutationFn: () => api.writeOff({ assignmentId: a.id, amount: Math.round(Number(amount)), remarks }), onSuccess: () => (refresh(studentId), onClose()) });
  return (
    <Modal
      title={`Write off – ${a.feeTypeName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending || !(Number(amount) > 0) || remarks.trim().length < 3} onClick={() => save.mutate()}>
            Write off {inr(Number(amount) || 0)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Use when a student leaves (or for an exceptional waiver): the unpaid fee is cancelled from the last installment back. Unpaid now: <b>{inr(unpaid)}</b>. Money already paid is returned with a refund on the receipt.
      </p>
      <div className="grid gap-3">
        <Field label="Amount to write off (₹)">
          <Input type="number" min={1} max={unpaid} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <ReasonField value={remarks} onChange={setRemarks} presets={['T C taken', 'Shifted to another branch', 'Left the school mid-year']} />
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

// ======================= late fee waiver =======================

export function WaiveFineModal({ i, studentId, onClose }: { i: FeeInvoiceDto; studentId: string; onClose: () => void }) {
  const refresh = useRefreshFees();
  const [remarks, setRemarks] = useState('');
  const save = useMutation({ mutationFn: () => api.waiveFine(i.id, remarks), onSuccess: () => (refresh(studentId), onClose()) });
  return (
    <Modal
      title={`Waive late fee – ${i.label}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending || remarks.trim().length < 3} onClick={() => save.mutate()}>
            Waive {inr(i.lateFee)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Waives the {inr(i.lateFee)} late fee owed today. If the installment stays unpaid, the late fee starts again from tomorrow.</p>
      <ReasonField value={remarks} onChange={setRemarks} />
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** A student's corrections, for the fee account on the profile (staff). */
export function CorrectionsHistory({ studentId }: { studentId: string }) {
  const q = useQuery({ queryKey: ['corrections', studentId], queryFn: () => api.studentCorrections(studentId) });
  if (!q.data?.length) return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <b className="mb-2 block text-sm">Concessions, write-offs and waivers</b>
      <Table
        rows={q.data}
        rowKey={(c) => c.id}
        columns={[
          { header: 'Date', cell: (c) => c.createdAt.slice(0, 10) },
          { header: 'Type', cell: (c) => <Badge tone={c.kind === 'ADJUSTMENT' ? 'amber' : 'blue'}>{CORRECTION_LABEL[c.kind]}</Badge> },
          { header: 'Fee', cell: (c) => c.feeTypeName },
          { header: 'Amount', cell: (c) => inr(c.amount), className: 'text-right' },
          { header: 'Reason', cell: (c) => <span className="whitespace-normal">{c.remarks}</span> },
          { header: 'By', cell: (c) => <span className="text-muted">{c.createdByName}</span> },
        ]}
      />
    </div>
  );
}

// ======================= refund (on the receipt page) =======================

export function RefundModal({ r, onDone, onClose }: { r: ReceiptDto; onDone: (r: ReceiptDto) => void; onClose: () => void }) {
  const [f, setF] = useState({ amount: String(r.refundable), mode: 'Cheque' as PaymentMode, bank: '', instrumentNo: '', remarks: '' });
  const save = useMutation({
    mutationFn: () => api.refund({ receiptId: r.id, amount: Math.round(Number(f.amount)), mode: f.mode, bank: f.bank || null, instrumentNo: f.instrumentNo || null, remarks: f.remarks }),
    onSuccess: (x) => (onDone(x), onClose()),
  });
  const needsNo = INSTRUMENT_MODES.includes(f.mode);
  return (
    <Modal
      title={`Refund against ${r.no}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending || !(Number(f.amount) > 0) || f.remarks.trim().length < 3 || (needsNo && !f.instrumentNo)} onClick={() => save.mutate()}>
            Refund {inr(Number(f.amount) || 0)}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Up to <b>{inr(r.refundable)}</b> of the fee on this receipt can be paid back (late fees are not refunded). The balance doesn't change; to cancel what is still unpaid, write it off from the student's fee account.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)">
          <Input type="number" min={1} max={r.refundable} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Paid back by">
          <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as PaymentMode })} options={PAYMENT_MODES.map((m): [string, string] => [m, m])} />
        </Field>
        {f.mode !== 'Cash' && (
          <>
            <Field label="Bank">
              <Input value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} />
            </Field>
            <Field label={needsNo ? `${f.mode} number` : 'Reference'}>
              <Input required={needsNo} value={f.instrumentNo} onChange={(e) => setF({ ...f, instrumentNo: e.target.value })} />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <ReasonField value={f.remarks} onChange={(v) => setF({ ...f, remarks: v })} presets={['Joined another school', 'Shifted to the PU college', 'Paid twice']} />
        </div>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

// ======================= reports =======================

function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

type ReportTab = 'dues' | 'classes' | 'corrections' | 'parallel';
export function FeeReports() {
  const [tab, setTab] = useState<ReportTab>('dues');
  return (
    <div className="space-y-4">
      <Tabs
        items={[
          ['dues', 'Dues'],
          ['classes', 'Class summary'],
          ['corrections', 'Concessions & refunds'],
          ['parallel', 'Parallel run'],
        ]}
        value={tab}
        onChange={setTab}
      />
      <p className="text-sm">
        Moving from SchoolElement? <Link to="/import/balances">Import previous-year balances →</Link>
      </p>
      {tab === 'dues' && <DuesReport />}
      {tab === 'classes' && <ClassSummary />}
      {tab === 'corrections' && <CorrectionsReport />}
      {tab === 'parallel' && <ParallelRun />}
    </div>
  );
}

function DuesReport() {
  const { branchId } = useScope();
  const [overdueOnly, setOverdueOnly] = useState(true);
  const q = useQuery({ queryKey: ['fee-reports', 'dues', branchId, overdueOnly], queryFn: () => api.duesReport({ branchId, overdueOnly: String(overdueOnly) }) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <Card
      title={`${d.totals.students} student(s) · ${inr(overdueOnly ? d.totals.overdue : d.totals.balance)} ${overdueOnly ? 'overdue' : 'unpaid'} · late fees ${inr(d.totals.lateFee)}`}
      actions={
        <span className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
          </label>
          <SendReminders count={d.rows.filter((r) => r.overdue > 0).length} />
          <Button
            onClick={() =>
              downloadCsv(`dues-${d.asOf}.csv`, [
                ['Admission no', 'Student', 'Class', 'Branch', 'Parent', 'Mobile', 'Balance', 'Overdue', 'Late fee today', 'Unpaid installments'],
                ...d.rows.map((r) => [r.admissionNo, r.studentName, r.className, r.branchName, r.guardian?.name ?? '', r.guardian?.phone ?? '', r.balance, r.overdue, r.lateFee, r.dues.map((x) => `${x.label} (due ${x.dueDate}): ${x.balance}`).join('; ')]),
              ])
            }
          >
            Download CSV
          </Button>
        </span>
      }
    >
      <Table
        rows={d.rows}
        rowKey={(r) => r.studentId}
        empty="Nobody owes anything 🎉"
        columns={[
          { header: 'Student', cell: (r) => <Link to={`/fees?tab=collect&student=${r.studentId}`}>{r.studentName}</Link> },
          { header: 'Class', cell: (r) => r.className ?? '—' },
          { header: 'Parent', cell: (r) => (r.guardian ? `${r.guardian.name} · ${r.guardian.phone ?? ''}` : '—') },
          { header: 'Unpaid', cell: (r) => <span className="text-xs whitespace-normal">{r.dues.map((x) => `${x.label} (${x.dueDate})`).join(', ')}</span> },
          { header: 'Balance', cell: (r) => inr(r.balance), className: 'text-right' },
          { header: 'Overdue', cell: (r) => (r.overdue ? <span className="text-red-700">{inr(r.overdue)}</span> : '—'), className: 'text-right' },
          { header: 'Late fee', cell: (r) => (r.lateFee ? inr(r.lateFee) : '—'), className: 'text-right' },
        ]}
      />
    </Card>
  );
}

function ClassSummary() {
  const { branchId, isTenantWide } = useScope();
  const q = useQuery({ queryKey: ['fee-reports', 'classes', branchId], queryFn: () => api.classSummary({ branchId }) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const cols = ['students', 'billed', 'concession', 'adjustment', 'collected', 'refunded', 'balance', 'overdue', 'finePaid', 'fineWaived'] as const;
  const head: Record<(typeof cols)[number], string> = { students: 'Students', billed: 'Billed', concession: 'Concession', adjustment: 'Written off', collected: 'Collected (net)', refunded: 'Refunded', balance: 'Balance', overdue: 'Overdue', finePaid: 'Late fee paid', fineWaived: 'Late fee waived' };
  const pct = (r: { billed: number; concession: number; adjustment: number; collected: number; refunded: number }) => {
    const due = r.billed - r.concession - r.adjustment;
    return due > 0 ? Math.round(((r.collected + r.refunded) / due) * 100) : 0;
  };
  return (
    <Card
      title={`Class summary ${d.academicYear} · ${pct(d.totals)}% collected`}
      actions={
        <Button onClick={() => downloadCsv(`class-summary-${d.academicYear}.csv`, [['Branch', 'Class', ...cols.map((c) => head[c]), '% collected'], ...d.rows.map((r) => [r.branchName, r.className, ...cols.map((c) => r[c]), pct(r)]), ['', 'Total', ...cols.map((c) => d.totals[c]), pct(d.totals)]])}>
          Download CSV
        </Button>
      }
    >
      <Table
        rows={[...d.rows, { classId: 'total', className: 'Total', branchName: '', ...d.totals }]}
        rowKey={(r) => r.classId ?? 'none'}
        columns={[
          ...(isTenantWide && !branchId ? [{ header: 'Branch', cell: (r: (typeof d.rows)[number]) => r.branchName }] : []),
          { header: 'Class', cell: (r) => (r.classId === 'total' ? <b>Total</b> : r.className) },
          ...cols.map((c) => ({ header: head[c], cell: (r: (typeof d.rows)[number]) => (c === 'students' ? r[c] : r[c] ? inr(r[c]) : '—'), className: 'text-right' })),
          { header: '%', cell: (r) => `${pct(r)}%`, className: 'text-right' },
        ]}
      />
    </Card>
  );
}

function CorrectionsReport() {
  const { branchId } = useScope();
  const today = todayISO();
  const [f, setF] = useState({ from: today.slice(0, 8) + '01', to: today, kind: '' });
  const q = useQuery({ queryKey: ['fee-reports', 'corrections', branchId, f], queryFn: () => api.correctionsReport({ branchId, ...f }) });
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From">
            <Input type="date" value={f.from} max={today} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={f.to} min={f.from} max={today} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </Field>
          <Field label="Show">
            <Select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
              options={[
                ['', 'Everything'],
                ['CONCESSION', 'Concessions'],
                ['ADJUSTMENT', 'Write-offs'],
                ['FINE_WAIVER', 'Late fee waivers'],
                ['REFUND', 'Refunds'],
                ['CANCELLED', 'Cancelled receipts'],
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
          <p className="text-sm">
            Concessions <b>{inr(q.data.totals.concession)}</b> · Write-offs <b>{inr(q.data.totals.adjustment)}</b> · Late fees waived <b>{inr(q.data.totals.fineWaiver)}</b> · Refunds <b>{inr(q.data.totals.refund)}</b> · Cancelled receipts <b>{inr(q.data.totals.cancelled)}</b>
          </p>
          {(!f.kind || ['CONCESSION', 'ADJUSTMENT', 'FINE_WAIVER'].includes(f.kind)) && (
            <Card
              title="Concessions, write-offs and waivers"
              actions={
                <Button onClick={() => downloadCsv(`corrections-${f.from}-${f.to}.csv`, [['Date', 'Type', 'Admission no', 'Student', 'Class', 'Fee', 'Amount', 'Reason', 'By'], ...q.data!.corrections.map((c) => [c.createdAt.slice(0, 10), CORRECTION_LABEL[c.kind], c.admissionNo, c.studentName, c.className, c.feeTypeName, c.amount, c.remarks, c.createdByName])])}>
                  Download CSV
                </Button>
              }
            >
              <Table
                rows={q.data.corrections}
                rowKey={(c) => c.id}
                empty="None in this period"
                columns={[
                  { header: 'Date', cell: (c) => c.createdAt.slice(0, 10) },
                  { header: 'Type', cell: (c) => CORRECTION_LABEL[c.kind] },
                  { header: 'Student', cell: (c) => <Link to={`/students/${c.studentId}`}>{c.studentName}</Link> },
                  { header: 'Class', cell: (c) => c.className ?? '—' },
                  { header: 'Fee', cell: (c) => c.feeTypeName },
                  { header: 'Amount', cell: (c) => inr(c.amount), className: 'text-right' },
                  { header: 'Reason', cell: (c) => <span className="text-xs whitespace-normal">{c.remarks}</span> },
                  { header: 'By', cell: (c) => <span className="text-muted">{c.createdByName}</span> },
                ]}
              />
            </Card>
          )}
          {(!f.kind || f.kind === 'REFUND') && (
            <Card title="Refunds">
              <Table
                rows={q.data.refunds}
                rowKey={(r) => r.id}
                empty="None in this period"
                columns={[
                  { header: 'Date', cell: (r) => r.date },
                  { header: 'Receipt', cell: (r) => <Link to={`/receipts/${r.receiptId}`} className="font-mono">{r.receiptNo}</Link> },
                  { header: 'Student', cell: (r) => r.studentName },
                  { header: 'Class', cell: (r) => r.className ?? '—' },
                  { header: 'Amount', cell: (r) => inr(r.amount), className: 'text-right' },
                  { header: 'Paid by', cell: (r) => `${r.mode}${r.instrumentNo ? ` ${r.instrumentNo}` : ''}` },
                  { header: 'Reason', cell: (r) => <span className="text-xs whitespace-normal">{r.remarks}</span> },
                  { header: 'By', cell: (r) => <span className="text-muted">{r.createdByName}</span> },
                ]}
              />
            </Card>
          )}
          {(!f.kind || f.kind === 'CANCELLED') && (
            <Card title="Cancelled receipts">
              <Table
                rows={q.data.cancellations}
                rowKey={(r) => r.id}
                empty="None in this period"
                columns={[
                  { header: 'Cancelled', cell: (r) => r.cancelledAt.slice(0, 10) },
                  { header: 'Receipt', cell: (r) => <Link to={`/receipts/${r.id}`} className="font-mono">{r.no}</Link> },
                  { header: 'Paid on', cell: (r) => r.date },
                  { header: 'Student', cell: (r) => r.studentName },
                  { header: 'Amount', cell: (r) => inr(r.total), className: 'text-right' },
                  { header: 'Reason', cell: (r) => <span className="text-xs whitespace-normal">{r.cancelReason}</span> },
                ]}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ======================= parallel run with SchoolElement =======================

const PARALLEL_LABEL: Record<ParallelStatus, [string, 'green' | 'amber' | 'red' | 'blue']> = {
  MATCH: ['Same', 'green'],
  DIFFERENT: ['Different amount', 'red'],
  ONLY_THEIRS: ['Only in SchoolElement', 'amber'],
  ONLY_OURS: ['Only here', 'blue'],
};

/** Upload SchoolElement's Daily Transaction export and see where the two systems disagree. Nothing is saved. */
function ParallelRun() {
  const { branchId } = useScope();
  const [onlyDiff, setOnlyDiff] = useState(true);
  const run = useMutation({ mutationFn: (csv: string) => api.parallelRun({ branchId, csv }) });
  const d = run.data;
  const rows = d ? (onlyDiff ? d.rows.filter((r) => r.status !== 'MATCH') : d.rows) : [];
  return (
    <div className="space-y-4">
      <Card title="Compare with SchoolElement">
        <p className="mb-2 text-sm text-muted">
          While both systems are in use, export SchoolElement's <b>Daily Transaction</b> report as CSV (any date range) and upload it here. Each student's payments for each day are compared with the receipts in this system. Receipt numbers differ between the systems, so the match is on admission number, date and amount. Nothing is saved.
        </p>
        <input type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) run.mutate(await f.text()); }} />
        {run.isPending && <p className="mt-2 text-muted">Comparing…</p>}
        <div className="mt-2">
          <ErrorBox error={run.error} />
        </div>
      </Card>
      {d && (
        <Card
          title={`${d.from === d.to ? d.from : `${d.from} to ${d.to}`}: SchoolElement ${inr(d.totals.theirs)} · this system ${inr(d.totals.ours)}`}
          actions={
            <span className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Differences only
              </label>
              <Button
                onClick={() =>
                  downloadCsv(`parallel-run-${d.from}-${d.to}.csv`, [
                    ['Date', 'Admission no', 'Student', 'Result', 'SchoolElement amount', 'SchoolElement receipts', 'This system amount', 'This system receipts'],
                    ...d.rows.map((r) => [r.date, r.admissionNo, r.studentName, PARALLEL_LABEL[r.status][0], r.theirs.total, r.theirs.receipts.join(' '), r.ours.total, r.ours.receipts.join(' ')]),
                  ])
                }
              >
                Download CSV
              </Button>
            </span>
          }
        >
          <p className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{d.totals.matched} same</Badge>
            <Badge tone="red">{d.totals.different} different amount</Badge>
            <Badge tone="amber">{d.totals.onlyTheirs} only in SchoolElement</Badge>
            <Badge tone="blue">{d.totals.onlyOurs} only here</Badge>
            {d.totals.theirs === d.totals.ours && d.totals.different + d.totals.onlyTheirs + d.totals.onlyOurs === 0 && <span className="text-green-800">✅ The two systems agree.</span>}
          </p>
          {!!d.ignoredColumns.length && <p className="mb-2 text-xs text-muted">Columns not used: {d.ignoredColumns.join(', ')}</p>}
          {!!d.fileErrors.length && (
            <p className="mb-2 text-sm text-amber-800">
              {d.fileErrors.length} row(s) skipped: {d.fileErrors.slice(0, 3).map((e) => `line ${e.line}: ${e.error}`).join('; ')}
              {d.fileErrors.length > 3 ? '…' : ''}
            </p>
          )}
          <Table
            rows={rows}
            rowKey={(r) => `${r.date}|${r.admissionNo}`}
            empty={onlyDiff ? 'No differences 🎉' : 'Nothing to compare'}
            columns={[
              { header: 'Date', cell: (r) => r.date },
              { header: 'Admission no', cell: (r) => <span className="font-mono text-xs">{r.admissionNo}</span> },
              { header: 'Student', cell: (r) => r.studentName || '—' },
              { header: 'Result', cell: (r) => <Badge tone={PARALLEL_LABEL[r.status][1]}>{PARALLEL_LABEL[r.status][0]}</Badge> },
              { header: 'SchoolElement', cell: (r) => (r.theirs.count ? `${inr(r.theirs.total)} (${r.theirs.count})` : '—'), className: 'text-right' },
              { header: 'This system', cell: (r) => (r.ours.count ? `${inr(r.ours.total)} (${r.ours.count})` : '—'), className: 'text-right' },
              { header: 'Receipts here', cell: (r) => <span className="font-mono text-xs">{r.ours.receipts.join(', ') || '—'}</span> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
