import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADMISSION_TYPES,
  CREATABLE_FEE_KINDS,
  FEE_KIND_LABEL,
  hasRateChart,
  PICKUP_MODES,
  gradeLabel,
  rateKey,
  type FeeAction,
  type FeeActionResult,
  type FeeAssignmentDto,
  type FeeBandDto,
  type FeeInvoiceDto,
  type FeeInstallmentDto,
  type FeeKind,
  type FeeTypeDto,
  type InvoiceStatus,
  type StudentFeesDto,
} from '@sms/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CollectPanel, ReceiptRegister, StudentReceipts } from './Collection';
import { OnlinePaymentsReport, PayOnline } from './Payments';
import { ConcessionModal, CorrectionsHistory, FeeReports, WaiveFineModal, WriteOffModal } from './Corrections';
import { useAuth } from '../lib/auth';
import { useScope } from '../lib/scope';
import { NeedsBranch } from '../components/BranchPicker';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs } from '../components/ui';

export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = { Paid: 'green', Partial: 'amber', Overdue: 'red', Pending: 'blue', ASSIGNED: 'gray', CONFIRMED: 'blue', PUBLISHED: 'green' };
const STATUS_LABEL: Record<string, string> = { ASSIGNED: 'Assigned', CONFIRMED: 'Confirmed', PUBLISHED: 'Published' };

export function Fees() {
  const { user } = useAuth();
  if (user?.role === 'parent') return <FamilyFees />;
  return <StaffFees />;
}

type Tab = 'collect' | 'receipts' | 'online' | 'reports' | 'overview' | 'assign' | 'setup';
function StaffFees() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'collect');
  return (
    <div>
      <PageHeader title="Fees & Invoices" sub="Counter collection and receipts, the fee chart, invoices and publishing." />
      <Tabs
        items={[
          ['collect', 'Collect'],
          ['receipts', 'Receipts'],
          ['online', 'Online payments'],
          ['reports', 'Reports'],
          ['overview', 'Overview'],
          ['assign', 'Assign & publish'],
          ['setup', 'Fee setup'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'collect' && <CollectPanel initialStudentId={params.get('student') ?? undefined} />}
      {tab === 'receipts' && <ReceiptRegister />}
      {tab === 'online' && <OnlinePaymentsReport />}
      {tab === 'reports' && <FeeReports />}
      {tab === 'overview' && <Overview onSetup={() => setTab('setup')} />}
      {tab === 'assign' && <NeedsBranch>{(b) => <AssignPublish key={b} branchId={b} />}</NeedsBranch>}
      {tab === 'setup' && <NeedsBranch>{(b) => <FeeSetup key={b} branchId={b} />}</NeedsBranch>}
    </div>
  );
}

function PlaceholderBanner({ onSetup }: { onSetup?: () => void }) {
  return (
    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      ⚠ Fee amounts are <b>placeholders</b> until the school confirms its fee chart. Edit them under Fee setup, then tick “Amounts confirmed by the school”.
      {onSetup && (
        <button className="ml-2 font-semibold underline" onClick={onSetup}>
          Open fee setup
        </button>
      )}
    </p>
  );
}

function Overview({ onSetup }: { onSetup: () => void }) {
  const { branchId, isTenantWide } = useScope();
  const q = useQuery({ queryKey: ['fee-overview', branchId], queryFn: () => api.feeOverview({ branchId }) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  return (
    <div>
      {o.placeholderRates && <PlaceholderBanner onSetup={onSetup} />}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Billed', inr(o.totals.billed)],
          ['Collected', inr(o.totals.paid)],
          ['Outstanding', inr(o.totals.balance)],
          ['Overdue', inr(o.totals.overdue)],
          ['Not yet published', String(o.totals.unpublished)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-card border border-line bg-card p-3">
            <div className="text-xl font-bold">{v}</div>
            <div className="text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>
      <Card title={`Fee types · ${o.academicYear}`}>
        <Table
          rows={o.rows}
          rowKey={(r) => r.feeTypeId}
          empty="No fee types for this year. Create them under Fee setup."
          columns={[
            { header: 'Fee type', cell: (r) => <b>{r.feeTypeName}</b> },
            ...(isTenantWide && !branchId ? [{ header: 'Branch', cell: (r: { branchName: string }) => r.branchName.replace('BNM ', '') }] : []),
            { header: 'Assigned', cell: (r) => (r.kind === 'SCHOOL' ? `${r.assigned} / ${r.students}` : r.assigned) },
            { header: 'Published', cell: (r) => r.published },
            { header: 'Billed', cell: (r) => inr(r.billed), className: 'text-right' },
            { header: 'Collected', cell: (r) => inr(r.paid), className: 'text-right' },
            { header: 'Overdue', cell: (r) => <span className={r.overdue ? 'text-red-700' : ''}>{inr(r.overdue)}</span>, className: 'text-right' },
          ]}
        />
        <p className="mt-3 text-xs text-muted">Collected stays at ₹0 until fee collection goes live (sprint 5); until then, every past-due installment shows as overdue.</p>
      </Card>
    </div>
  );
}

// ======================= Assign & publish =======================

function AssignPublish({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['fee-setup', branchId, ''], queryFn: () => api.feeSetup(branchId) });
  const classes = useQuery({ queryKey: ['classes', branchId], queryFn: () => api.classes(branchId) });
  const types = (setup.data?.feeTypes ?? []).filter((t) => t.active);
  const [typeId, setTypeId] = useState('');
  const [classId, setClassId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<{ action: FeeAction; r: FeeActionResult } | null>(null);
  useEffect(() => {
    if (types.length && !types.some((t) => t.id === typeId)) setTypeId(types[0].id);
  }, [types, typeId]);
  useEffect(() => {
    if (classes.data?.length && !classes.data.some((c) => c.id === classId)) setClassId(classes.data[0].id);
  }, [classes.data, classId]);
  useEffect(() => {
    setSelected(new Set());
    setResult(null);
  }, [typeId, classId]);

  const board = useQuery({ queryKey: ['fee-board', typeId, classId], queryFn: () => api.feeBoard(typeId, classId), enabled: !!typeId && !!classId });
  const act = useMutation({
    mutationFn: (action: FeeAction) => api.feeAction({ feeTypeId: typeId, studentIds: [...selected], action, amount: amount ? Number(amount) : undefined }),
    onSuccess: (r, action) => {
      setResult({ action, r });
      void qc.invalidateQueries({ queryKey: ['fee-board'] });
      void qc.invalidateQueries({ queryKey: ['fee-overview'] });
      void qc.invalidateQueries({ queryKey: ['fee-setup'] });
    },
  });

  if (setup.isLoading || classes.isLoading) return <Loading />;
  if (!types.length) return <Card>No fee types for this branch and year yet. Create them under Fee setup.</Card>;
  const b = board.data;
  const rows = b?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.studentId));
  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const isCustom = b?.feeType.kind === 'CUSTOM';
  const isPrevious = b?.feeType.kind === 'PREVIOUS';
  const ACTIONS: [FeeAction, string, 'primary' | 'default' | 'danger'][] = [
    ['assign', 'Assign', 'primary'],
    ['confirm', 'Confirm', 'default'],
    ['publish', 'Publish to parents', 'default'],
    ['online_on', 'Enable online payment', 'default'],
    ['online_off', 'Disable online', 'default'],
    ['unpublish', 'Unpublish', 'default'],
    ['reset', 'Remove (reset)', 'danger'],
  ];
  const reasons = result ? Object.entries(result.r.skipped.reduce<Record<string, number>>((m, s) => ({ ...m, [s.reason]: (m[s.reason] ?? 0) + 1 }), {})) : [];

  return (
    <div className="space-y-4">
      {types.some((t) => hasRateChart(t.kind) && !t.ratesConfirmed) && <PlaceholderBanner />}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Fee type" className="min-w-[14rem]">
            <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} options={types.map((t): [string, string] => [t.id, t.name])} />
          </Field>
          <Field label="Class" className="min-w-[10rem]">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)} options={(classes.data ?? []).map((c): [string, string] => [c.id, c.name])} />
          </Field>
          {isPrevious && <p className="text-sm text-muted">Previous-year balances are loaded with Import → Previous-year balances; here you can confirm, publish and switch on online payment.</p>}
          {isCustom && (
            <Field label="Amount per student (₹, for Assign)">
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="max-w-[10rem]" />
            </Field>
          )}
        </div>
        {b && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <Badge>{b.counts.students} students</Badge>
            <Badge tone="amber">{b.counts.unassigned} not assigned</Badge>
            <Badge>{b.counts.assigned} assigned</Badge>
            <Badge tone="blue">{b.counts.confirmed} confirmed</Badge>
            <Badge tone="green">{b.counts.published} published</Badge>
            <Badge tone="green">{b.counts.online} online</Badge>
          </div>
        )}
      </Card>
      <ErrorBox error={board.error ?? act.error} />
      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.r.done ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
          {result.r.done ? `✅ ${result.r.done} student(s) updated.` : 'Nothing changed.'}
          {reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {reasons.map(([reason, n]) => (
                <li key={reason}>
                  {n} skipped: {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Card
        title={`${selected.size} selected`}
        actions={
          <div className="flex flex-wrap justify-end gap-1.5">
            {ACTIONS.map(([a, l, v]) => (
              <Button key={a} variant={v} disabled={!selected.size || act.isPending} onClick={() => (a !== 'reset' || confirm(`Remove ${b?.feeType.name} from ${selected.size} student(s)?`)) && act.mutate(a)}>
                {l}
              </Button>
            ))}
          </div>
        }
      >
        {board.isLoading ? (
          <Loading />
        ) : (
          <Table
            rows={rows}
            rowKey={(r) => r.studentId}
            empty="No students in this class"
            columns={[
              {
                header: '',
                cell: (r) => <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.studentId)} onChange={() => toggle(r.studentId)} />,
              },
              { header: 'Roll', cell: (r) => r.rollNo ?? '—' },
              { header: 'Student', cell: (r) => <b>{r.name}</b> },
              {
                header: 'Fee profile',
                cell: (r) => (
                  <span className="text-xs">
                    {r.profile.admissionType}
                    {r.profile.transportSlab ? ` · 🚌 ${r.profile.transportSlab} (${r.profile.pickupMode})` : ''}
                    {r.profile.rte ? ' · RTE' : ''}
                    {r.profile.staffKid ? ' · Staff child' : ''}
                  </span>
                ),
              },
              { header: 'Chart price', cell: (r) => (r.quote ? `${inr(r.quote.amount)}` : isCustom ? '—' : <span className="text-xs text-muted">no rate</span>), className: 'text-right' },
              {
                header: 'Invoice',
                cell: (r) =>
                  r.assignment ? (
                    <span className="flex flex-wrap items-center gap-1">
                      {inr(r.assignment.gross)} <Badge tone={STATUS_TONE[r.assignment.status]}>{STATUS_LABEL[r.assignment.status]}</Badge>
                      {r.assignment.onlineEnabled && <Badge tone="green">Online</Badge>}
                      {r.quote && r.quote.amount !== r.assignment.gross && <Badge tone="amber">Chart now {inr(r.quote.amount)}</Badge>}
                    </span>
                  ) : (
                    <span className="text-muted">Not assigned</span>
                  ),
              },
            ]}
          />
        )}
        {rows.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.studentId)))} /> Select all {rows.length}
          </label>
        )}
      </Card>
    </div>
  );
}

// ======================= Fee setup =======================

function FeeSetup({ branchId }: { branchId: string }) {
  const years = useQuery({ queryKey: ['years'], queryFn: api.academicYears });
  const current = years.data?.find((y) => y.current);
  const [yearId, setYearId] = useState('');
  const y = yearId || current?.id || '';
  const setup = useQuery({ queryKey: ['fee-setup', branchId, y], queryFn: () => api.feeSetup(branchId, y), enabled: !!y });
  const [adding, setAdding] = useState(false);
  if (setup.isLoading || years.isLoading) return <Loading />;
  if (!setup.data) return <ErrorBox error={setup.error} />;
  const s = setup.data;
  const year = years.data?.find((x) => x.id === y);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Academic year">
          <Select value={y} onChange={(e) => setYearId(e.target.value)} options={(years.data ?? []).map((x): [string, string] => [x.id, `${x.label}${x.current ? ' (current)' : ''}${x.locked ? ' – locked' : ''}`])} />
        </Field>
        <span className="flex-1" />
        {!year?.locked && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add fee type
          </Button>
        )}
      </div>
      <BandsEditor branchId={branchId} bands={s.bands} />
      {!s.feeTypes.length && <Card>No fee types for {year?.label} yet. Add one, or copy last year’s from that year’s setup.</Card>}
      {s.feeTypes.map((t) => (
        <FeeTypeCard key={t.id} t={t} bands={s.bands} years={(years.data ?? []).filter((x) => x.id !== t.academicYearId && !x.locked)} />
      ))}
      {adding && year && <NewFeeType branchId={branchId} academicYearId={y} yearLabel={year.label} startsOn={year.startsOn} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BandsEditor({ branchId, bands }: { branchId: string; bands: FeeBandDto[] }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState(bands.map(({ name, fromGrade, toGrade }) => ({ name, fromGrade, toGrade })));
  const dirty = JSON.stringify(rows) !== JSON.stringify(bands.map(({ name, fromGrade, toGrade }) => ({ name, fromGrade, toGrade })));
  const save = useMutation({ mutationFn: () => api.saveFeeBands(branchId, rows), onSuccess: () => qc.invalidateQueries({ queryKey: ['fee-setup'] }) });
  const GR: [string, string][] = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => [String(g), gradeLabel(g)]);
  return (
    <Card
      title="Class bands (school fee is priced per band)"
      actions={
        <>
          <Button onClick={() => setRows([...rows, { name: '', fromGrade: 1, toGrade: 1 }])}>+ Band</Button>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            Save bands
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label="Band name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="max-w-[10rem]" placeholder="e.g. G5–G7" />
            <span className="text-sm text-muted">grades</span>
            <Select aria-label="From grade" value={String(r.fromGrade)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, fromGrade: Number(e.target.value) } : x)))} options={GR} className="max-w-[7rem]" />
            <span className="text-sm text-muted">to</span>
            <Select aria-label="To grade" value={String(r.toGrade)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, toGrade: Number(e.target.value) } : x)))} options={GR} className="max-w-[7rem]" />
            <Button variant="ghost" aria-label="Remove band" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-muted">No bands yet.</p>}
      </div>
    </Card>
  );
}

function FeeTypeCard({ t, bands, years }: { t: FeeTypeDto; bands: FeeBandDto[]; years: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(t.rates).map(([k, v]) => [k, String(v)])));
  const [slabs, setSlabs] = useState<string[]>(t.slabs);
  const [copyTo, setCopyTo] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['fee-setup'] });
  const saveRates = useMutation({
    mutationFn: () => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(rates)) if (v.trim() !== '') out[k] = Number(v);
      // Drop rates of removed transport slabs.
      if (t.kind === 'TRANSPORT') for (const k of Object.keys(out)) if (!slabs.includes(k.split('|')[0])) delete out[k];
      return api.saveFeeRates(t.id, out);
    },
    onSuccess: refresh,
  });
  const confirmRates = useMutation({ mutationFn: (v: boolean) => api.updateFeeType(t.id, { ratesConfirmed: v }), onSuccess: refresh });
  const copy = useMutation({ mutationFn: () => api.copyFeeType(t.id, copyTo), onSuccess: () => (setCopyTo(''), refresh()) });
  const cell = (key: string) => (
    <Input aria-label={`Amount ${key}`} inputMode="numeric" value={rates[key] ?? ''} onChange={(e) => setRates({ ...rates, [key]: e.target.value.replace(/[^\d]/g, '') })} className="w-28! py-1 text-right" placeholder="—" />
  );

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t.name} <Badge>{t.kind}</Badge> {hasRateChart(t.kind) && (t.ratesConfirmed ? <Badge tone="green">Amounts confirmed</Badge> : <Badge tone="amber">Placeholder amounts</Badge>)}
          <span className="text-xs font-normal text-muted">{t.assignedCount} students assigned</span>
        </span>
      }
    >
      <div className="mb-3 text-sm">
        <span className="text-muted">Installments: </span>
        {t.installments.map((i) => `${i.label} (due ${i.dueDate})`).join(' · ')}
        <span className="ml-2 text-muted">· Components: {t.components.map((c) => `${c.name} ${c.percent}%`).join(', ')}</span>
      </div>
      <ErrorBox error={saveRates.error ?? confirmRates.error ?? copy.error} />
      {t.kind === 'SCHOOL' && (
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-max text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="px-4 py-1 text-left">Band \ admission type (₹ per year)</th>
                {ADMISSION_TYPES.map((a) => (
                  <th key={a} className="px-2 py-1">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-1 font-semibold">{b.name}</td>
                  {ADMISSION_TYPES.map((a) => (
                    <td key={a} className="px-2 py-1">
                      {cell(rateKey(b.name, a))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {t.kind === 'TRANSPORT' && (
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-max text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="px-4 py-1 text-left">Distance slab (₹ per year)</th>
                {PICKUP_MODES.map((m) => (
                  <th key={m} className="px-2 py-1">
                    {m}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {slabs.map((sl, i) => (
                <tr key={i}>
                  <td className="px-4 py-1">
                    <Input
                      aria-label="Slab name"
                      value={sl}
                      onChange={(e) => {
                        const next = e.target.value;
                        // Carry the amounts over when a slab is renamed.
                        setRates(Object.fromEntries(Object.entries(rates).map(([k, v]) => (k.split('|')[0] === sl ? [rateKey(next, k.split('|')[1]), v] : [k, v]))));
                        setSlabs(slabs.map((x, j) => (j === i ? next : x)));
                      }}
                      className="w-36! py-1"
                    />
                  </td>
                  {PICKUP_MODES.map((m) => (
                    <td key={m} className="px-2 py-1">
                      {cell(rateKey(sl, m))}
                    </td>
                  ))}
                  <td>
                    <Button variant="ghost" aria-label="Remove slab" onClick={() => setSlabs(slabs.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button variant="ghost" onClick={() => setSlabs([...slabs, `Slab ${slabs.length + 1}`])} className="ml-2">
            + Slab
          </Button>
        </div>
      )}
      {t.kind === 'APPLICATION' && <Field label="Amount for every applicant (₹)">{cell('*')}</Field>}
      {t.kind === 'CUSTOM' && <p className="text-sm text-muted">Custom fees take their amount when you assign them (Assign & publish).</p>}
      {t.kind === 'PREVIOUS' && <p className="text-sm text-muted">Balances from earlier years, loaded per student with Import → Previous-year balances. No late fee is charged on them.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {hasRateChart(t.kind) && (
          <>
            <Button variant="primary" disabled={saveRates.isPending} onClick={() => saveRates.mutate()}>
              {saveRates.isPending ? 'Saving…' : 'Save amounts'}
            </Button>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={t.ratesConfirmed} disabled={confirmRates.isPending} onChange={(e) => confirmRates.mutate(e.target.checked)} /> Amounts confirmed by the school
            </label>
          </>
        )}
        <span className="flex-1" />
        {years.length > 0 && (
          <>
            <Select aria-label="Copy to year" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} options={[['', 'Copy to year…'], ...years.map((y): [string, string] => [y.id, y.label])]} className="max-w-[10rem] py-1" />
            <Button disabled={!copyTo || copy.isPending} onClick={() => copy.mutate()}>
              Copy
            </Button>
          </>
        )}
      </div>
      {saveRates.isSuccess && <p className="mt-2 text-sm text-green-700">Saved. Students already assigned keep their amount; new assignments use the new chart.</p>}
    </Card>
  );
}

function NewFeeType({ branchId, academicYearId, yearLabel, startsOn, onClose }: { branchId: string; academicYearId: string; yearLabel: string; startsOn: string; onClose: () => void }) {
  const qc = useQueryClient();
  const yy = `${yearLabel.slice(2, 4)}-${yearLabel.slice(5, 7)}`;
  const y0 = Number(startsOn.slice(0, 4));
  const PRESETS: Record<Exclude<FeeKind, 'PREVIOUS'>, { name: string; inst: FeeInstallmentDto[] }> = {
    SCHOOL: { name: `School Fees ${yy}`, inst: ['04-05', '07-05', '10-05', '01-05'].map((md, i) => ({ seq: i + 1, label: `Installment ${i + 1}`, dueDate: `${md.startsWith('01') ? y0 + 1 : y0}-${md}` })) },
    TRANSPORT: { name: `Transportation Fees ${yy}`, inst: ['04-05', '10-05'].map((md, i) => ({ seq: i + 1, label: `Transport Inst ${i + 1}`, dueDate: `${y0}-${md}` })) },
    APPLICATION: { name: `Application Fee ${yy}`, inst: [{ seq: 1, label: 'Application Fee', dueDate: `${y0}-04-05` }] },
    CUSTOM: { name: '', inst: [{ seq: 1, label: 'Payment', dueDate: `${y0}-06-01` }] },
  };
  const [kind, setKind] = useState<FeeKind>('SCHOOL');
  const [name, setName] = useState(PRESETS.SCHOOL.name);
  const [inst, setInst] = useState<FeeInstallmentDto[]>(PRESETS.SCHOOL.inst);
  const m = useMutation({
    mutationFn: () => api.createFeeType({ branchId, academicYearId, kind, name, installments: inst.map((i, k) => ({ ...i, seq: k + 1 })) }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['fee-setup'] }), onClose()),
  });
  return (
    <Modal
      title={`Add fee type for ${yearLabel}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={m.isPending || !name.trim()} onClick={() => m.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">
          <Select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as Exclude<FeeKind, 'PREVIOUS'>;
              setKind(k);
              setName(PRESETS[k].name);
              setInst(PRESETS[k].inst);
            }}
            options={CREATABLE_FEE_KINDS.map((k): [string, string] => [k, FEE_KIND_LABEL[k]])}
          />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Excursion fee" />
        </Field>
      </div>
      <h4 className="mt-4 mb-1 text-sm font-semibold">Installments (amount split equally)</h4>
      {inst.map((i, k) => (
        <div key={k} className="mb-2 flex gap-2">
          <Input aria-label="Installment label" value={i.label} onChange={(e) => setInst(inst.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} />
          <Input aria-label="Due date" type="date" value={i.dueDate} onChange={(e) => setInst(inst.map((x, j) => (j === k ? { ...x, dueDate: e.target.value } : x)))} className="max-w-[11rem]" />
          {inst.length > 1 && (
            <Button variant="ghost" aria-label="Remove installment" onClick={() => setInst(inst.filter((_, j) => j !== k))}>
              ✕
            </Button>
          )}
        </div>
      ))}
      {inst.length < 12 && (
        <Button variant="ghost" onClick={() => setInst([...inst, { seq: inst.length + 1, label: `Installment ${inst.length + 1}`, dueDate: inst[inst.length - 1].dueDate }])}>
          + Installment
        </Button>
      )}
      <p className="mt-2 text-xs text-muted">Installments can’t be changed once students are assigned this fee, so check them now. Amounts are set after creating.</p>
    </Modal>
  );
}

// ======================= student + family views =======================

/** Fee account of one student: used on the student profile (staff) and the parent's Fees page. */
export function StudentFees({ studentId, staff }: { studentId: string; staff?: boolean }) {
  const q = useQuery({ queryKey: ['student-fees', studentId], queryFn: () => api.studentFees(studentId) });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const f = q.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Billed {inr(f.totals.gross)}</Badge>
        <Badge tone="green">Paid {inr(f.totals.paid)}</Badge>
        <Badge tone={f.totals.balance ? 'amber' : 'green'}>Balance {inr(f.totals.balance)}</Badge>
        {f.totals.overdue > 0 && <Badge tone="red">Overdue {inr(f.totals.overdue)}</Badge>}
        {staff && (
          <>
            <Link to={`/fees?tab=collect&student=${f.studentId}`} className="ml-1 text-sm font-semibold">
              Collect fee →
            </Link>
            <span className="ml-2 text-xs text-muted">
              {f.profile.admissionType}
              {f.profile.transportSlab ? ` · 🚌 ${f.profile.transportSlab} (${f.profile.pickupMode})` : ' · no transport'}
              {f.profile.rte ? ' · RTE' : ''}
              {f.profile.staffKid ? ' · Staff child' : ''}
            </span>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit fee profile
            </Button>
          </>
        )}
      </div>
      {!f.assignments.length && <p className="text-sm text-muted">{staff ? 'No fees assigned yet.' : 'No fees have been published yet.'}</p>}
      {!staff && <PayOnline key={f.studentId + f.totals.balance} f={f} />}
      {f.assignments.map((a) => (
        <AssignmentTable key={a.id} a={a} staff={staff} studentId={f.studentId} />
      ))}
      <StudentReceipts studentId={f.studentId} />
      {staff && <CorrectionsHistory studentId={f.studentId} />}
      {editing && <FeeProfileForm f={f} onClose={() => setEditing(false)} />}
    </div>
  );
}

function AssignmentTable({ a, staff, studentId }: { a: FeeAssignmentDto; staff?: boolean; studentId: string }) {
  const [modal, setModal] = useState<'concession' | 'writeoff' | null>(null);
  const [waive, setWaive] = useState<FeeInvoiceDto | null>(null);
  const writtenOff = a.invoices.some((i) => i.adjustment > 0);
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <b>{a.feeTypeName}</b>
        <span className="text-muted">{a.category}</span>
        {staff && <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>}
        {a.onlineEnabled && <Badge tone="green">Online payment on</Badge>}
        {staff && (
          <span className="ml-auto flex gap-1">
            <Button variant="ghost" onClick={() => setModal('concession')}>
              Concession
            </Button>
            <Button variant="ghost" disabled={!a.totals.balance} onClick={() => setModal('writeoff')}>
              Write off
            </Button>
          </span>
        )}
      </div>
      {modal === 'concession' && <ConcessionModal a={a} studentId={studentId} onClose={() => setModal(null)} />}
      {modal === 'writeoff' && <WriteOffModal a={a} studentId={studentId} onClose={() => setModal(null)} />}
      {waive && <WaiveFineModal i={waive} studentId={studentId} onClose={() => setWaive(null)} />}
      <Table
        rows={a.invoices}
        rowKey={(i) => i.id}
        columns={[
          { header: 'Installment', cell: (i) => i.label },
          { header: 'Due', cell: (i) => i.dueDate },
          { header: 'Amount', cell: (i) => inr(i.gross), className: 'text-right' },
          { header: 'Concession', cell: (i) => (i.concession ? inr(i.concession) : '—'), className: 'text-right' },
          ...(writtenOff ? [{ header: 'Written off', cell: (i: FeeInvoiceDto) => (i.adjustment ? inr(i.adjustment) : '—'), className: 'text-right' }] : []),
          { header: 'Paid', cell: (i) => (i.paid ? inr(i.paid) : '—'), className: 'text-right' },
          { header: 'Balance', cell: (i) => inr(Math.max(0, i.balance)), className: 'text-right' },
          {
            header: 'Late fee',
            className: 'text-right',
            cell: (i) =>
              i.lateFee ? (
                <span className="whitespace-nowrap text-red-700">
                  {inr(i.lateFee)}
                  {staff && (
                    <button className="ml-2 text-xs font-semibold text-brand" onClick={() => setWaive(i)}>
                      Waive
                    </button>
                  )}
                </span>
              ) : (
                '—'
              ),
          },
          { header: 'Status', cell: (i) => <Badge tone={STATUS_TONE[i.status as InvoiceStatus]}>{i.status}</Badge> },
        ]}
      />
    </div>
  );
}

function FeeProfileForm({ f, onClose }: { f: StudentFeesDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [p, setP] = useState({ ...f.profile, transportSlab: f.profile.transportSlab ?? '', pickupMode: f.profile.pickupMode ?? '' });
  const m = useMutation({
    mutationFn: () => api.updateFeeProfile(f.studentId, { ...p, transportSlab: p.transportSlab || null, pickupMode: p.pickupMode || null }),
    onSuccess: () => (void qc.invalidateQueries({ queryKey: ['student-fees', f.studentId] }), void qc.invalidateQueries({ queryKey: ['fee-board'] }), onClose()),
  });
  return (
    <Modal
      title={`Fee profile – ${f.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <p className="mb-3 text-sm text-muted">Decides which rate applies when fees are assigned. Changing it does not alter invoices already assigned.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Admission type">
          <Select value={p.admissionType} onChange={(e) => setP({ ...p, admissionType: e.target.value })} options={ADMISSION_TYPES.map((a): [string, string] => [a, a])} />
        </Field>
        <Field label="Transport distance slab" hint="Leave blank for no school transport">
          <Input value={p.transportSlab} onChange={(e) => setP({ ...p, transportSlab: e.target.value })} placeholder="e.g. 1 to 2 km" />
        </Field>
        <Field label="Pickup mode">
          <Select value={p.pickupMode} onChange={(e) => setP({ ...p, pickupMode: e.target.value })} options={[['', '—'], ...PICKUP_MODES.map((m): [string, string] => [m, m])]} />
        </Field>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={p.rte} onChange={(e) => setP({ ...p, rte: e.target.checked })} /> RTE student
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={p.staffKid} onChange={(e) => setP({ ...p, staffKid: e.target.checked })} /> Staff child
          </label>
        </div>
      </div>
    </Modal>
  );
}

function FamilyFees() {
  const kids = useQuery({ queryKey: ['my-students'], queryFn: api.myStudents });
  const [idx, setIdx] = useState(0);
  const kid = useMemo(() => kids.data?.[idx], [kids.data, idx]);
  return (
    <div>
      <PageHeader title="Fees" sub="Published fees, installments and receipts. Pay online or at the school office." />
      {kids.data && kids.data.length > 1 && (
        <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-line">
          {kids.data.map((k, i) => (
            <button key={k.id} onClick={() => setIdx(i)} className={`px-3 py-1.5 text-sm font-semibold ${i === idx ? 'bg-brand text-white' : 'bg-white'}`}>
              {k.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}
      <ErrorBox error={kids.error} />
      {kid ? <StudentFees studentId={kid.id} /> : !kids.isLoading && <p className="text-muted">No student linked to this account.</p>}
    </div>
  );
}
