import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LATE_FEE_PER_DAY, type BranchDetailDto, type BranchInput } from '@sms/shared';
import { api } from '../lib/api';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader } from '../components/ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Branches() {
  const { isSchoolAdmin } = useScope();
  const q = useQuery({ queryKey: ['branch-details'], queryFn: api.branchDetails });
  const [editing, setEditing] = useState<BranchDetailDto | 'new' | null>(null);

  return (
    <div>
      <PageHeader
        title="Branches & Config"
        sub={isSchoolAdmin ? 'Institutions under the trust and their settings' : 'Your branch details. Only the School Admin can change them.'}
        actions={isSchoolAdmin && <Button variant="primary" onClick={() => setEditing('new')}>+ Add branch</Button>}
      />
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data?.map((b) => (
          <Card
            key={b.id}
            title={
              <span className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-full" style={{ background: b.color }} />
                {b.name} {!b.active && <Badge>Inactive</Badge>}
              </span>
            }
            actions={isSchoolAdmin && <Button onClick={() => setEditing(b)}>Edit</Button>}
          >
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Code</dt>
              <dd className="font-mono">{b.code}</dd>
              <dt className="text-muted">Board</dt>
              <dd>{b.board}</dd>
              <dt className="text-muted">City</dt>
              <dd>{b.city ?? '—'}</dd>
              <dt className="text-muted">Phone</dt>
              <dd>{b.phone ?? '—'}</dd>
              <dt className="text-muted">Working days</dt>
              <dd>{b.settings.workingDays?.join(', ') ?? '—'}</dd>
              <dt className="text-muted">Timings</dt>
              <dd>{b.settings.startsAt && b.settings.endsAt ? `${b.settings.startsAt} – ${b.settings.endsAt}` : '—'}</dd>
              <dt className="text-muted">Attendance alert below</dt>
              <dd>{b.settings.attendanceThreshold != null ? `${b.settings.attendanceThreshold}%` : '—'}</dd>
              <dt className="text-muted">Late fee</dt>
              <dd>₹{b.settings.lateFeePerDay ?? LATE_FEE_PER_DAY} per day</dd>
            </dl>
            <div className="mt-3 flex gap-4 border-t border-line pt-3 text-sm">
              <span>
                <b>{b.counts.students}</b> students
              </span>
              <span>
                <b>{b.counts.classes}</b> classes
              </span>
              <span>
                <b>{b.counts.staff}</b> staff
              </span>
            </div>
          </Card>
        ))}
      </div>
      {editing && <BranchForm branch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BranchForm({ branch, onClose }: { branch: BranchDetailDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    board: branch?.board ?? '',
    color: branch?.color ?? '#e8650a',
    city: branch?.city ?? '',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
    email: branch?.email ?? '',
    active: branch?.active ?? true,
    workingDays: branch?.settings.workingDays ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    startsAt: branch?.settings.startsAt ?? '08:30',
    endsAt: branch?.settings.endsAt ?? '15:30',
    attendanceThreshold: String(branch?.settings.attendanceThreshold ?? 75),
    lateFeePerDay: String(branch?.settings.lateFeePerDay ?? LATE_FEE_PER_DAY),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const body: BranchInput = {
        code: f.code.trim().toUpperCase(),
        name: f.name,
        board: f.board,
        color: f.color,
        city: f.city || null,
        address: f.address || null,
        phone: f.phone || null,
        email: f.email || null,
        active: f.active,
        settings: { workingDays: f.workingDays, startsAt: f.startsAt, endsAt: f.endsAt, attendanceThreshold: Number(f.attendanceThreshold), lateFeePerDay: Number(f.lateFeePerDay) },
      };
      if (branch) {
        const { code: _code, ...rest } = body;
        return api.updateBranch(branch.id, rest);
      }
      return api.createBranch(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['branch-details'] });
      void qc.invalidateQueries({ queryKey: ['branches'] });
      onClose();
    },
  });

  return (
    <Modal
      title={branch ? `Edit ${branch.name}` : 'Add branch'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Branch name">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Code" hint={branch ? 'Used in admission and receipt numbers; cannot be changed.' : '2–10 capital letters or digits, e.g. BNMPS'}>
          <Input value={f.code} onChange={set('code')} disabled={!!branch} className="font-mono uppercase" />
        </Field>
        <Field label="Board / curriculum">
          <Input value={f.board} onChange={set('board')} placeholder="ICSE / ISC" />
        </Field>
        <Field label="City / locality">
          <Input value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={f.address} onChange={set('address')} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="School starts">
          <Input type="time" value={f.startsAt} onChange={set('startsAt')} />
        </Field>
        <Field label="School ends">
          <Input type="time" value={f.endsAt} onChange={set('endsAt')} />
        </Field>
        <Field label="Attendance alert below (%)">
          <Input type="number" min={0} max={100} value={f.attendanceThreshold} onChange={set('attendanceThreshold')} />
        </Field>
        <Field label="Late fee (₹ per day overdue)">
          <Input type="number" min={0} max={1000} value={f.lateFeePerDay} onChange={set('lateFeePerDay')} />
        </Field>
        <Field label="Brand colour">
          <Input type="color" value={f.color} onChange={set('color')} className="h-10 p-1" />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-semibold text-muted">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={f.workingDays.includes(d)}
                  onChange={(e) => setF({ ...f, workingDays: e.target.checked ? DAYS.filter((x) => x === d || f.workingDays.includes(x)) : f.workingDays.filter((x) => x !== d) })}
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        {branch && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.active} onChange={set('active')} /> Branch is active (inactive branches are hidden from everyday screens)
          </label>
        )}
      </div>
    </Modal>
  );
}
