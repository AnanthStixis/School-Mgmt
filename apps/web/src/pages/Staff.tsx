import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StaffAccess, StaffDto, StaffInput } from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, statusTone } from '../components/ui';

const ACCESS_LABEL: Record<StaffAccess, string> = {
  none: 'No login',
  teacher: 'Teacher – classes, attendance, marks, homework',
  accounts: 'Accounts – fees, expenses',
  manager: 'Branch manager – runs this branch',
};

export function Staff() {
  const { branchId, isTenantWide } = useScope();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Active');
  const [editing, setEditing] = useState<StaffDto | 'new' | null>(null);
  const q = useQuery({ queryKey: ['staff', branchId, search, status], queryFn: () => api.staff({ branchId, q: search, status }) });

  return (
    <div>
      <PageHeader
        title="Staff"
        sub="Staff directory and who can sign in. Payroll comes in phase 2."
        actions={
          <>
            <Link to="/import/staff">
              <Button>Import CSV</Button>
            </Link>
            <Button variant="primary" onClick={() => setEditing('new')}>
              + Add staff
            </Button>
          </>
        }
      />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Search name, subject or mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[['Active', 'Active'], ['Inactive', 'Inactive'], ['', 'All']]} className="max-w-[10rem]" />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? (
          <Loading />
        ) : (
          <Table
            rows={q.data ?? []}
            rowKey={(s) => s.id}
            onRowClick={(s) => setEditing(s)}
            columns={[
              { header: 'Name', cell: (s) => <b>{s.name}</b> },
              { header: 'Role', cell: (s) => s.role },
              { header: 'Subject / dept', cell: (s) => s.subject ?? '—' },
              ...(isTenantWide && !branchId ? [{ header: 'Branch', cell: (s: StaffDto) => s.branchName }] : []),
              { header: 'Class teacher of', cell: (s) => s.classTeacherOf.join(', ') || '—' },
              { header: 'Mobile', cell: (s) => s.phone ?? '—' },
              { header: 'Login', cell: (s) => (s.access === 'none' ? <span className="text-muted">—</span> : <Badge tone="blue">{s.access}</Badge>) },
              { header: 'Status', cell: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
            ]}
          />
        )}
      </Card>
      {editing && <StaffForm staff={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StaffForm({ staff, onClose }: { staff: StaffDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { branches, branchId, isSchoolAdmin } = useScope();
  const [f, setF] = useState({
    branchId: staff?.branchId ?? branchId ?? branches[0]?.id ?? '',
    name: staff?.name ?? '',
    role: staff?.role ?? 'Teacher',
    subject: staff?.subject ?? '',
    phone: staff?.phone?.replace(/^\+91/, '') ?? '',
    email: staff?.email ?? '',
    qualification: staff?.qualification ?? '',
    joinedOn: staff?.joinedOn ?? '',
    access: staff?.access ?? ('none' as StaffAccess),
    status: staff?.status ?? 'Active',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  // Branch managers may not grant or change manager access; that option is only offered to the School Admin.
  const accessOptions = (Object.keys(ACCESS_LABEL) as StaffAccess[]).filter((a) => a !== 'manager' || isSchoolAdmin || staff?.access === 'manager');
  const lockedAccess = !isSchoolAdmin && staff?.access === 'manager';
  const isSelf = !!user && staff?.email === user.email && !!user.email;

  const m = useMutation({
    mutationFn: () => {
      const body: StaffInput = {
        branchId: f.branchId,
        name: f.name,
        role: f.role,
        subject: f.subject || null,
        phone: f.phone || null,
        email: f.email || null,
        qualification: f.qualification || null,
        joinedOn: f.joinedOn || null,
        access: f.access,
        status: f.status as 'Active' | 'Inactive',
      };
      return staff ? api.updateStaff(staff.id, body) : api.createStaff(body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });

  return (
    <Modal
      title={staff ? staff.name : 'Add staff'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Branch">
          <Select value={f.branchId} onChange={set('branchId')} disabled={!!staff || branches.length < 2} options={branches.map((b): [string, string] => [b.id, b.name])} />
        </Field>
        <Field label="Designation">
          <Input value={f.role} onChange={set('role')} placeholder="Teacher, Accounts Officer…" />
        </Field>
        <Field label="Subject / department">
          <Input value={f.subject} onChange={set('subject')} />
        </Field>
        <Field label="Mobile" hint="Staff with a login sign in with a code sent to this number">
          <Input type="tel" inputMode="numeric" value={f.phone} onChange={set('phone')} placeholder="98765 43210" />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Qualification">
          <Input value={f.qualification} onChange={set('qualification')} />
        </Field>
        <Field label="Joined on">
          <Input type="date" value={f.joinedOn} onChange={set('joinedOn')} />
        </Field>
        <Field label="Login access" hint={lockedAccess ? 'Only the School Admin can change a manager’s access' : undefined}>
          <Select value={f.access} onChange={set('access')} disabled={lockedAccess || isSelf} options={accessOptions.map((a): [string, string] => [a, ACCESS_LABEL[a]])} />
        </Field>
        {staff && (
          <Field label="Status" hint="Inactive staff lose their login immediately">
            <Select value={f.status} onChange={set('status')} disabled={lockedAccess || isSelf} options={[['Active', 'Active'], ['Inactive', 'Inactive']]} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
