import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canAccess, GUARDIAN_RELATIONS, STUDENT_STATUSES, type GuardianInput, type StudentDto, type StudentInput, type StudentStatus } from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useScope } from '../lib/scope';
import { StudentAttendance } from './Attendance';
import { StudentFees } from './Fees';
import { StudentLoginPanel } from '../components/StudentLogin';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pager, Select, Table, statusTone } from '../components/ui';

const PAGE_SIZE = 25;

export function Students() {
  const nav = useNavigate();
  const { branchId, isTenantWide, isManager, branchName } = useScope();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('Active');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, classId, status, branchId]);
  useEffect(() => setClassId(''), [branchId]);

  const classes = useQuery({ queryKey: ['classes', branchId], queryFn: () => api.classes(branchId || undefined) });
  const q = useQuery({
    queryKey: ['students', branchId, debounced, classId, status, page],
    queryFn: () => api.students({ branchId, q: debounced, classId, status, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  return (
    <div>
      <PageHeader
        title="Students"
        sub={q.data ? `${q.data.total} ${status ? status.toLowerCase() : ''} students` : undefined}
        actions={
          isManager && (
            <>
              <Link to="/import/students">
                <Button>Import CSV</Button>
              </Link>
              <Button variant="primary" onClick={() => setAdding(true)}>
                + Add student
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input placeholder="Search name, admission no. or parent mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          <Select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="max-w-[14rem]"
            options={[['', 'All classes'], ...(classes.data ?? []).map((c): [string, string] => [c.id, isTenantWide && !branchId ? `${c.name} · ${branchName(c.branchId)}` : c.name])]}
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]" options={[['', 'All statuses'], ...STUDENT_STATUSES.map((s): [string, string] => [s, s])]} />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? (
          <Loading />
        ) : (
          <>
            <Table
              rows={q.data?.items ?? []}
              rowKey={(s) => s.id}
              onRowClick={(s) => nav(`/students/${s.id}`)}
              empty="No students match these filters"
              columns={[
                { header: 'Adm. no.', cell: (s) => <span className="font-mono text-xs">{s.admissionNo}</span> },
                { header: 'Name', cell: (s) => <b>{s.name}</b> },
                { header: 'Class', cell: (s) => s.className ?? <span className="text-muted">—</span> },
                { header: 'Roll', cell: (s) => s.rollNo ?? '—' },
                ...(isTenantWide && !branchId ? [{ header: 'Branch', cell: (s: { branchName: string }) => s.branchName }] : []),
                { header: 'Parent', cell: (s) => (s.primaryGuardian ? `${s.primaryGuardian.name} · ${s.primaryGuardian.phone?.replace('+91', '') ?? ''}` : '—') },
                { header: 'Status', cell: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
              ]}
            />
            {q.data && <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      {adding && <StudentForm student={null} onClose={() => setAdding(false)} onSaved={(s) => nav(`/students/${s.id}`)} />}
    </div>
  );
}

export function StudentDetail() {
  const { id = '' } = useParams();
  const { isManager } = useScope();
  const { user } = useAuth();
  const showAttendance = !!user && canAccess('attendance', user.role);
  const showFees = user?.role === 'accounts' || user?.role === 'manager';
  const q = useQuery({ queryKey: ['student', id], queryFn: () => api.student(id) });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? new Error('Student not found')} />;
  const s = q.data;
  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{value || '—'}</dd>
    </>
  );
  return (
    <div>
      <PageHeader
        title={s.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{s.admissionNo}</span>· {s.className ?? 'No class'} · {s.branchName} <Badge tone={statusTone(s.status)}>{s.status}</Badge>
          </span>
        }
        actions={
          <>
            <Link to="/students">
              <Button>‹ All students</Button>
            </Link>
            {isManager && (
              <Button variant="primary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Details">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            {row('Gender', { M: 'Male', F: 'Female', O: 'Other' }[s.gender ?? ''])}
            {row('Date of birth', s.dob)}
            {row('Roll no.', s.rollNo)}
            {row('Blood group', s.bloodGroup)}
            {row('House', s.house)}
            {row('Admitted on', s.admittedOn)}
            {row('Address', s.address)}
          </dl>
        </Card>
        <Card title="Guardians">
          <ul className="space-y-2">
            {s.guardians.map((g) => (
              <li key={g.userId} className="flex flex-wrap items-center gap-2">
                <b>{g.name}</b> <span className="text-muted">{g.relation}</span> {g.primary && <Badge tone="blue">Primary</Badge>}
                <span className="w-full text-sm text-muted">
                  {g.phone} {g.email && `· ${g.email}`}
                </span>
              </li>
            ))}
          </ul>
          {s.siblings.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-1 text-sm font-semibold">Siblings (same parent mobile)</h3>
              {s.siblings.map((x) => (
                <Link key={x.id} to={`/students/${x.id}`} className="mr-3 text-sm">
                  {x.name} ({x.className ?? '—'})
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
      {showAttendance && <div className="mt-4">
        <Card title="Attendance (last two months)" actions={<Link to="/attendance" className="text-sm">Attendance →</Link>}>
          <StudentAttendance studentId={s.id} compact />
        </Card>
      </div>}
      {user?.role === 'manager' && <StudentLoginCard studentId={s.id} />}
      {showFees && (
        <div className="mt-4">
          <Card title="Fees" actions={<Link to="/fees" className="text-sm">Fees & Invoices →</Link>}>
            <StudentFees studentId={s.id} staff />
          </Card>
        </div>
      )}
      <p className="mt-4 text-sm text-muted">Marks for this student appear here when the exams module is built.</p>
      {editing && <StudentForm student={s} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

/** School office view of the student's sign-in (parents manage it from their own dashboard too). */
function StudentLoginCard({ studentId }: { studentId: string }) {
  const q = useQuery({ queryKey: ['student-login', studentId], queryFn: () => api.studentLoginStatus(studentId) });
  return (
    <div className="mt-4">
      <Card title="Student sign-in">
        {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorBox error={q.error} /> : <StudentLoginPanel status={q.data} />}
      </Card>
    </div>
  );
}

const emptyGuardian = (relation: string, primary = false): GuardianInput => ({ name: '', phone: '', email: '', relation, primary });

function StudentForm({ student, onClose, onSaved }: { student: StudentDto | null; onClose: () => void; onSaved: (s: StudentDto) => void }) {
  const qc = useQueryClient();
  const { branches, branchId } = useScope();
  const [b, setB] = useState(student?.branchId ?? branchId ?? branches[0]?.id ?? '');
  const classes = useQuery({ queryKey: ['classes', b], queryFn: () => api.classes(b), enabled: !!b });
  const [f, setF] = useState({
    admissionNo: student?.admissionNo ?? '',
    name: student?.name ?? '',
    gender: student?.gender ?? '',
    dob: student?.dob ?? '',
    classId: student?.classId ?? '',
    rollNo: student?.rollNo ? String(student.rollNo) : '',
    bloodGroup: student?.bloodGroup ?? '',
    house: student?.house ?? '',
    address: student?.address ?? '',
    status: student?.status ?? ('Active' as StudentStatus),
  });
  const [guardians, setGuardians] = useState<GuardianInput[]>(
    student?.guardians.map((g) => ({ name: g.name, phone: g.phone?.replace(/^\+91/, '') ?? '', email: g.email ?? '', relation: g.relation, primary: g.primary })) ?? [emptyGuardian('Father', true)],
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const setG = (i: number, patch: Partial<GuardianInput>) => setGuardians(guardians.map((g, j) => (j === i ? { ...g, ...patch } : patch.primary ? { ...g, primary: false } : g)));

  const m = useMutation({
    mutationFn: () => {
      const body: StudentInput = {
        branchId: b,
        admissionNo: f.admissionNo || null,
        name: f.name,
        gender: f.gender || null,
        dob: f.dob || null,
        classId: f.classId || null,
        rollNo: f.rollNo ? Number(f.rollNo) : null,
        bloodGroup: f.bloodGroup || null,
        house: f.house || null,
        address: f.address || null,
        status: f.status,
        guardians: guardians.map((g) => ({ ...g, email: g.email || null })),
      };
      return student ? api.updateStudent(student.id, body) : api.createStudent(body);
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ['students'] });
      qc.setQueryData(['student', s.id], s);
      onSaved(s);
    },
  });

  return (
    <Modal
      title={student ? `Edit ${student.name}` : 'Add student'}
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Student name" className="sm:col-span-2">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Admission no." hint={student ? undefined : 'Leave blank to generate'}>
          <Input value={f.admissionNo} onChange={set('admissionNo')} className="font-mono" />
        </Field>
        {!student && branches.length > 1 && (
          <Field label="Branch">
            <Select value={b} onChange={(e) => (setB(e.target.value), setF({ ...f, classId: '' }))} options={branches.map((x): [string, string] => [x.id, x.name])} />
          </Field>
        )}
        <Field label="Class">
          <Select value={f.classId} onChange={set('classId')} options={[['', '— not assigned —'], ...(classes.data ?? []).map((c): [string, string] => [c.id, c.name])]} />
        </Field>
        <Field label="Roll no.">
          <Input type="number" min={1} value={f.rollNo} onChange={set('rollNo')} />
        </Field>
        <Field label="Gender">
          <Select value={f.gender} onChange={set('gender')} options={[['', '—'], ['M', 'Male'], ['F', 'Female'], ['O', 'Other']]} />
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={f.dob} onChange={set('dob')} />
        </Field>
        <Field label="Blood group">
          <Input value={f.bloodGroup} onChange={set('bloodGroup')} />
        </Field>
        <Field label="House">
          <Input value={f.house} onChange={set('house')} />
        </Field>
        {student && (
          <Field label="Status" hint="Left / Alumni keep the record but remove the student from class lists">
            <Select value={f.status} onChange={set('status')} options={STUDENT_STATUSES.map((s): [string, string] => [s, s])} />
          </Field>
        )}
        <Field label="Address" className="sm:col-span-3">
          <Input value={f.address} onChange={set('address')} />
        </Field>
      </div>

      <h4 className="mt-5 mb-1 font-semibold">Guardians</h4>
      <p className="mb-2 text-xs text-muted">The mobile number is the parent’s login. Using a number already on file links the students as siblings.</p>
      {guardians.map((g, i) => (
        <div key={i} className="mb-2 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_8rem_9rem_1fr_auto]">
          <Input aria-label="Guardian name" placeholder="Name" value={g.name} onChange={(e) => setG(i, { name: e.target.value })} />
          <Select aria-label="Relation" value={g.relation} onChange={(e) => setG(i, { relation: e.target.value })} options={GUARDIAN_RELATIONS.map((r): [string, string] => [r, r])} />
          <Input aria-label="Guardian mobile" type="tel" inputMode="numeric" placeholder="Mobile" value={g.phone} onChange={(e) => setG(i, { phone: e.target.value })} />
          <Input aria-label="Guardian e-mail" type="email" placeholder="E-mail (optional)" value={g.email ?? ''} onChange={(e) => setG(i, { email: e.target.value })} />
          <span className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" name="primary" checked={!!g.primary} onChange={() => setG(i, { primary: true })} /> Primary
            </label>
            {guardians.length > 1 && (
              <button className="text-red-700" aria-label="Remove guardian" onClick={() => setGuardians(guardians.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </span>
        </div>
      ))}
      {guardians.length < 3 && (
        <Button variant="ghost" onClick={() => setGuardians([...guardians, emptyGuardian(guardians.some((g) => g.relation === 'Mother') ? 'Guardian' : 'Mother')])}>
          + Add guardian
        </Button>
      )}
    </Modal>
  );
}
