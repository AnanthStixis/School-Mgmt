import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SUBJECT_TYPES, gradeLabel, type ClassDto, type SubjectDto, type SubjectType } from '@sms/shared';
import { api } from '../lib/api';
import { NeedsBranch } from '../components/BranchPicker';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs } from '../components/ui';

type Tab = 'classes' | 'subjects';
const GRADES: [string, string][] = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => [String(g), gradeLabel(g)]);

export function Setup() {
  const [tab, setTab] = useState<Tab>('classes');
  return (
    <div>
      <PageHeader title="Academic Setup" sub="Classes, sections and subjects for the current academic year" />
      <Tabs
        items={[
          ['classes', 'Classes & sections'],
          ['subjects', 'Subject master'],
        ]}
        value={tab}
        onChange={setTab}
      />
      <NeedsBranch>{(branchId) => (tab === 'classes' ? <Classes branchId={branchId} /> : <Subjects branchId={branchId} />)}</NeedsBranch>
    </div>
  );
}

function Classes({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const classes = useQuery({ queryKey: ['classes', branchId], queryFn: () => api.classes(branchId) });
  const staff = useQuery({ queryKey: ['staff', branchId, 'active'], queryFn: () => api.staff({ branchId, status: 'Active' }) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ClassDto | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['classes'] });
  const del = useMutation({ mutationFn: api.deleteClass, onSuccess: invalidate });

  return (
    <Card title={`${classes.data?.length ?? 0} classes`} actions={<Button variant="primary" onClick={() => setAdding(true)}>+ Add classes</Button>}>
      <ErrorBox error={classes.error ?? del.error} />
      {classes.isLoading ? (
        <Loading />
      ) : (
        <Table
          rows={classes.data ?? []}
          rowKey={(c) => c.id}
          empty="No classes for this year yet. Use “Add classes” to create them by grade range."
          columns={[
            { header: 'Class', cell: (c) => <b>{c.name}</b> },
            { header: 'Grade', cell: (c) => gradeLabel(c.grade) },
            { header: 'Section', cell: (c) => c.section },
            { header: 'Class teacher', cell: (c) => c.classTeacher?.name ?? <span className="text-muted">—</span> },
            { header: 'Room', cell: (c) => c.room ?? '—' },
            { header: 'Students', cell: (c) => c.studentCount, className: 'text-right' },
            {
              header: '',
              className: 'text-right',
              cell: (c) => (
                <span className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={c.studentCount > 0 || del.isPending}
                    title={c.studentCount > 0 ? 'Only empty classes can be deleted' : undefined}
                    onClick={() => confirm(`Delete ${c.name}?`) && del.mutate(c.id)}
                  >
                    Delete
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}
      {adding && <AddClasses branchId={branchId} onClose={() => setAdding(false)} onDone={invalidate} />}
      {editing && <EditClass cls={editing} teachers={(staff.data ?? []).filter((s) => s.role.toLowerCase().includes('teacher'))} onClose={() => setEditing(null)} onDone={invalidate} />}
    </Card>
  );
}

function AddClasses({ branchId, onClose, onDone }: { branchId: string; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('1');
  const [sections, setSections] = useState('A, B');
  const [result, setResult] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.createClasses({ branchId, fromGrade: Number(from), toGrade: Number(to), sections: sections.split(',').map((s) => s.trim()).filter(Boolean) }),
    onSuccess: (r) => {
      onDone();
      setResult(`Created ${r.created.length} class(es)${r.skipped.length ? `; skipped ${r.skipped.length} that already exist (${r.skipped.join(', ')})` : ''}.`);
    },
  });
  return (
    <Modal
      title="Add classes"
      onClose={onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>
              Create
            </Button>
          </>
        )
      }
    >
      <ErrorBox error={m.error} />
      {result ? (
        <p>{result}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From grade">
            <Select value={from} onChange={(e) => setFrom(e.target.value)} options={GRADES} />
          </Field>
          <Field label="To grade">
            <Select value={to} onChange={(e) => setTo(e.target.value)} options={GRADES} />
          </Field>
          <Field label="Sections (comma separated)" hint="e.g. A, B, C — or Sci, Com for PU College" className="sm:col-span-2">
            <Input value={sections} onChange={(e) => setSections(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function EditClass({ cls, teachers, onClose, onDone }: { cls: ClassDto; teachers: { id: string; name: string; subject: string | null }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: cls.name, section: cls.section, room: cls.room ?? '', classTeacherId: cls.classTeacher?.id ?? '' });
  const m = useMutation({
    mutationFn: () => api.updateClass(cls.id, { name: f.name, section: f.section, room: f.room || null, classTeacherId: f.classTeacherId || null }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      title={`Edit ${cls.name}`}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Section">
          <Input value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} />
        </Field>
        <Field label="Class teacher">
          <Select value={f.classTeacherId} onChange={(e) => setF({ ...f, classTeacherId: e.target.value })} options={[['', '— none —'], ...teachers.map((t): [string, string] => [t.id, `${t.name}${t.subject ? ` (${t.subject})` : ''}`])]} />
        </Field>
        <Field label="Room">
          <Input value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function Subjects({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['subjects', branchId], queryFn: () => api.subjects(branchId) });
  const [form, setForm] = useState<SubjectDto | 'new' | null>(null);
  const toggle = useMutation({ mutationFn: (s: SubjectDto) => api.updateSubject(s.id, { active: !s.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['subjects'] }) });
  return (
    <Card title={`${q.data?.length ?? 0} subjects`} actions={<Button variant="primary" onClick={() => setForm('new')}>+ Add subject</Button>}>
      <ErrorBox error={q.error ?? toggle.error} />
      {q.isLoading ? (
        <Loading />
      ) : (
        <Table
          rows={q.data ?? []}
          rowKey={(s) => s.id}
          columns={[
            { header: 'Subject', cell: (s) => <b>{s.name}</b> },
            { header: 'Code', cell: (s) => <span className="font-mono">{s.code}</span> },
            { header: 'Type', cell: (s) => s.type },
            { header: 'On report card', cell: (s) => (s.onReport ? 'Yes' : 'No') },
            { header: 'Status', cell: (s) => <Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'Active' : 'Inactive'}</Badge> },
            {
              header: '',
              className: 'text-right',
              cell: (s) => (
                <span className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => setForm(s)}>
                    Edit
                  </Button>
                  <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(s)}>
                    {s.active ? 'Deactivate' : 'Activate'}
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}
      {form && <SubjectForm branchId={branchId} subject={form === 'new' ? null : form} onClose={() => setForm(null)} />}
    </Card>
  );
}

function SubjectForm({ branchId, subject, onClose }: { branchId: string; subject: SubjectDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: subject?.name ?? '', code: subject?.code ?? '', type: subject?.type ?? ('Core' as SubjectType), onReport: subject?.onReport ?? true });
  const m = useMutation({
    mutationFn: () =>
      subject
        ? api.updateSubject(subject.id, { name: f.name, type: f.type, onReport: f.onReport })
        : api.createSubject({ branchId, name: f.name, code: f.code.trim().toUpperCase(), type: f.type, onReport: f.onReport, active: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subjects'] });
      onClose();
    },
  });
  return (
    <Modal
      title={subject ? `Edit ${subject.name}` : 'Add subject'}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subject name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Code" hint={subject ? 'Cannot be changed' : 'e.g. MAT'}>
          <Input value={f.code} disabled={!!subject} onChange={(e) => setF({ ...f, code: e.target.value })} className="font-mono uppercase" />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as SubjectType })} options={SUBJECT_TYPES.map((t): [string, string] => [t, t])} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.onReport} onChange={(e) => setF({ ...f, onReport: e.target.checked })} /> Show on report card
        </label>
      </div>
    </Modal>
  );
}
