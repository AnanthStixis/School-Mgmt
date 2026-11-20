import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ENQUIRY_SOURCES,
  ENQUIRY_STAGES,
  GUARDIAN_RELATIONS,
  PREVIOUS_BOARDS,
  gradeLabel,
  type EnquiryDetailDto,
  type EnquiryDto,
  type EnquiryInput,
  type PipelineStage,
} from '@sms/shared';
import { api } from '../lib/api';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select } from '../components/ui';

const GRADES: [string, string][] = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => [String(g), gradeLabel(g)]);
const SOURCE_TONE: Record<string, 'blue' | 'green' | 'amber' | 'gray'> = { Website: 'blue', 'Walk-in': 'green', Referral: 'green', 'Facebook Ad': 'amber', 'Google Ad': 'amber' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function Admissions() {
  const qc = useQueryClient();
  const { branchId, isTenantWide } = useScope();
  const years = useQuery({ queryKey: ['years'], queryFn: api.academicYears });
  const [yearId, setYearId] = useState('');
  const [search, setSearch] = useState('');
  const [showDropped, setShowDropped] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const params = { branchId, academicYearId: yearId };
  const list = useQuery({ queryKey: ['enquiries', params, search, showDropped], queryFn: () => api.enquiries({ ...params, q: search, includeClosed: showDropped }) });
  const stats = useQuery({ queryKey: ['enquiry-stats', params], queryFn: () => api.enquiryStats(params) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['enquiries'] });
    void qc.invalidateQueries({ queryKey: ['enquiry-stats'] });
  };
  const move = useMutation({ mutationFn: ({ id, stage }: { id: string; stage: PipelineStage }) => api.moveEnquiry(id, stage), onSuccess: refresh });

  const rows = list.data ?? [];
  const by = (s: string) => rows.filter((e) => e.stage === s);
  const s = stats.data;

  return (
    <div>
      <PageHeader
        title="Admissions"
        sub="Enquiry → Applied → Test / Interview → Admitted → Enrolled"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New enquiry
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Enquiries', s?.total],
          ['In pipeline', s?.open],
          ['Admitted / enrolled', s?.admittedOrEnrolled],
          ['Conversion', s ? `${s.conversion}%` : undefined],
          ['Follow-ups due', s?.followUpsDue],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-card border border-line bg-card p-3">
            <div className="text-2xl font-bold">{v ?? '…'}</div>
            <div className="text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search child, parent or mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={yearId} onChange={(e) => setYearId(e.target.value)} className="max-w-[11rem]" options={[['', 'All years'], ...(years.data ?? []).map((y): [string, string] => [y.id, `For ${y.label}`])]} />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={showDropped} onChange={(e) => setShowDropped(e.target.checked)} /> Show dropped
        </label>
      </div>
      <ErrorBox error={list.error ?? move.error} />
      {list.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {ENQUIRY_STAGES.map((stage, si) => (
              <div key={stage} className="rounded-card bg-slate-100 p-2">
                <h3 className="mb-2 flex items-center px-1 text-sm font-semibold">
                  <span className="flex-1">{stage}</span>
                  <Badge>{by(stage).length}</Badge>
                </h3>
                <div className="space-y-2">
                  {by(stage).map((e) => (
                    <EnquiryCard
                      key={e.id}
                      e={e}
                      showBranch={isTenantWide && !branchId}
                      onOpen={() => setOpenId(e.id)}
                      onBack={si > 0 ? () => move.mutate({ id: e.id, stage: ENQUIRY_STAGES[si - 1] }) : undefined}
                      onNext={si < 3 ? () => move.mutate({ id: e.id, stage: ENQUIRY_STAGES[si + 1] }) : undefined}
                      nextLabel={si === 2 ? 'Admit →' : 'Move →'}
                      busy={move.isPending}
                    />
                  ))}
                  {!by(stage).length && <p className="py-4 text-center text-xs text-muted">Empty</p>}
                </div>
              </div>
            ))}
          </div>
          {(by('Enrolled').length > 0 || (showDropped && by('Dropped').length > 0)) && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {by('Enrolled').length > 0 && (
                <Card title={`Enrolled (${by('Enrolled').length})`}>
                  <ul className="space-y-1 text-sm">
                    {by('Enrolled').map((e) => (
                      <li key={e.id}>
                        <Link to={`/students/${e.student?.id}`}>{e.childName}</Link> <span className="text-muted">· {e.student?.admissionNo}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {showDropped && by('Dropped').length > 0 && (
                <Card title={`Dropped (${by('Dropped').length})`}>
                  <ul className="space-y-1 text-sm">
                    {by('Dropped').map((e) => (
                      <li key={e.id}>
                        <button className="text-brand" onClick={() => setOpenId(e.id)}>
                          {e.childName}
                        </button>{' '}
                        <span className="text-muted">· {e.dropReason}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
        </>
      )}
      {creating && <EnquiryForm onClose={() => setCreating(false)} onSaved={(e) => (refresh(), setCreating(false), setOpenId(e.id))} />}
      {openId && <EnquiryPanel id={openId} onClose={() => setOpenId(null)} onChanged={refresh} onOpen={setOpenId} />}
    </div>
  );
}

function EnquiryCard(p: { e: EnquiryDto; showBranch: boolean; onOpen: () => void; onBack?: () => void; onNext?: () => void; nextLabel: string; busy: boolean }) {
  const { e } = p;
  const due = e.nextFollowUp && e.nextFollowUp <= today();
  return (
    <div className="rounded-lg border border-line bg-white p-2.5 text-sm shadow-sm">
      <button onClick={p.onOpen} className="block w-full text-left">
        <div className="flex items-start gap-2">
          <b className="flex-1">{e.childName}</b>
          <Badge>{gradeLabel(e.grade)}</Badge>
        </div>
        <div className="text-xs text-muted">
          {e.parentName} · {e.parentPhone.replace('+91', '')}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <Badge tone={SOURCE_TONE[e.source] ?? 'gray'}>{e.source}</Badge>
          <Badge>{e.academicYear}</Badge>
          {p.showBranch && <Badge tone="blue">{e.branchName.replace('BNM ', '')}</Badge>}
          {due && <Badge tone="red">Follow up {e.nextFollowUp === today() ? 'today' : 'overdue'}</Badge>}
          {e.possibleDuplicateOf && <Badge tone="amber">Possible duplicate</Badge>}
        </div>
      </button>
      <div className="mt-2 flex gap-1">
        {p.onBack && (
          <Button onClick={p.onBack} disabled={p.busy} aria-label="Move back">
            ←
          </Button>
        )}
        {p.onNext ? (
          <Button variant="primary" onClick={p.onNext} disabled={p.busy}>
            {p.nextLabel}
          </Button>
        ) : (
          <Button variant="primary" onClick={p.onOpen}>
            Enrol…
          </Button>
        )}
      </div>
    </div>
  );
}

function EnquiryPanel({ id, onClose, onChanged, onOpen }: { id: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['enquiry', id], queryFn: () => api.enquiry(id) });
  const [note, setNote] = useState('');
  const [follow, setFollow] = useState('');
  const [mode, setMode] = useState<'view' | 'edit' | 'drop' | 'enrol'>('view');
  const done = (e: EnquiryDetailDto) => {
    qc.setQueryData(['enquiry', id], e);
    onChanged();
    setMode('view');
  };
  const addNote = useMutation({ mutationFn: () => api.noteEnquiry(id, note, follow || undefined), onSuccess: (e) => (done(e), setNote(''), setFollow('')) });
  const e = q.data;

  if (mode === 'edit' && e) return <EnquiryForm enquiry={e} onClose={() => setMode('view')} onSaved={done} />;
  if (mode === 'drop' && e) return <DropForm e={e} onClose={() => setMode('view')} onDone={done} />;
  if (mode === 'enrol' && e) return <EnrolForm e={e} onClose={() => setMode('view')} onDone={done} />;

  const row = (l: string, v: React.ReactNode) => (
    <>
      <dt className="text-muted">{l}</dt>
      <dd>{v || '—'}</dd>
    </>
  );
  return (
    <Modal
      title={e ? e.childName : 'Enquiry'}
      onClose={onClose}
      wide
      footer={
        e && (
          <>
            {e.stage !== 'Enrolled' && e.stage !== 'Dropped' && (
              <Button variant="danger" onClick={() => setMode('drop')}>
                Drop…
              </Button>
            )}
            {e.stage !== 'Enrolled' && <Button onClick={() => setMode('edit')}>Edit</Button>}
            {e.stage === 'Admitted' && (
              <Button variant="primary" onClick={() => setMode('enrol')}>
                Enrol student…
              </Button>
            )}
            {e.student && (
              <Link to={`/students/${e.student.id}`}>
                <Button variant="primary">Open student {e.student.admissionNo}</Button>
              </Link>
            )}
          </>
        )
      }
    >
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error ?? addNote.error} />
      {e && (
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Badge tone={e.stage === 'Dropped' ? 'red' : e.stage === 'Enrolled' ? 'green' : 'blue'}>{e.stage}</Badge>
              <Badge>{gradeLabel(e.grade)}</Badge>
              <Badge>For {e.academicYear}</Badge>
              <Badge tone={SOURCE_TONE[e.source] ?? 'gray'}>{e.source}</Badge>
            </div>
            {e.possibleDuplicateOf && (
              <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                Same parent mobile and child name as an earlier enquiry.{' '}
                <button className="font-semibold underline" onClick={() => onOpen(e.possibleDuplicateOf!)}>
                  Open it
                </button>
              </p>
            )}
            {e.dropReason && <p className="mb-3 text-sm text-red-700">Dropped: {e.dropReason}</p>}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              {row('Branch', e.branchName)}
              {row('Parent', `${e.parentName} · ${e.parentPhone}`)}
              {row('Alternate', e.altPhone)}
              {row('E-mail', e.parentEmail)}
              {row('Date of birth', e.dob)}
              {row('Previous school', [e.previousSchool, e.previousBoard].filter(Boolean).join(' · '))}
              {row('Sibling in school', e.siblingInSchool ? 'Yes' : 'No')}
              {row('City', e.city)}
              {row('Next follow-up', e.nextFollowUp)}
            </dl>
          </div>
          <div>
            <h4 className="mb-2 font-semibold">Timeline</h4>
            {e.stage !== 'Enrolled' && (
              <div className="mb-3 space-y-2 rounded-lg border border-line p-2">
                <textarea value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Add a note (call outcome, documents pending…)" className="w-full rounded border border-line p-2 text-sm" rows={2} />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted">Follow up on</label>
                  <Input type="date" value={follow} onChange={(ev) => setFollow(ev.target.value)} className="max-w-[10rem] py-1" />
                  <Button variant="primary" className="ml-auto" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
                    Add note
                  </Button>
                </div>
              </div>
            )}
            <ol className="space-y-2 border-l-2 border-line pl-3 text-sm">
              {e.activity.map((a) => (
                <li key={a.id}>
                  <div className={a.kind === 'note' ? '' : 'font-semibold'}>{a.text}</div>
                  <div className="text-xs text-muted">
                    {a.byName ?? 'System'} · {new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

function EnquiryForm({ enquiry, onClose, onSaved }: { enquiry?: EnquiryDetailDto; onClose: () => void; onSaved: (e: EnquiryDetailDto) => void }) {
  const { branches, branchId } = useScope();
  const years = useQuery({ queryKey: ['years'], queryFn: api.academicYears });
  const openYears = (years.data ?? []).filter((y) => !y.locked);
  const [f, setF] = useState({
    branchId: enquiry?.branchId ?? branchId ?? branches[0]?.id ?? '',
    academicYearId: enquiry?.academicYearId ?? '',
    childName: enquiry?.childName ?? '',
    gender: enquiry?.gender ?? '',
    dob: enquiry?.dob ?? '',
    grade: String(enquiry?.grade ?? 1),
    parentName: enquiry?.parentName ?? '',
    parentPhone: enquiry?.parentPhone.replace(/^\+91/, '') ?? '',
    altPhone: enquiry?.altPhone?.replace(/^\+91/, '') ?? '',
    parentEmail: enquiry?.parentEmail ?? '',
    city: enquiry?.city ?? 'Bangalore',
    address: enquiry?.address ?? '',
    previousSchool: enquiry?.previousSchool ?? '',
    previousBoard: enquiry?.previousBoard ?? '',
    siblingInSchool: enquiry?.siblingInSchool ?? false,
    source: enquiry?.source ?? 'Walk-in',
    nextFollowUp: enquiry?.nextFollowUp ?? '',
  });
  // Default to the latest open year (usually next year's intake).
  const yearId = f.academicYearId || [...openYears].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0]?.id || '';
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body: EnquiryInput = {
        ...f,
        academicYearId: yearId,
        grade: Number(f.grade),
        gender: f.gender || null,
        dob: f.dob || null,
        altPhone: f.altPhone || null,
        parentEmail: f.parentEmail || null,
        city: f.city || null,
        address: f.address || null,
        previousSchool: f.previousSchool || null,
        previousBoard: f.previousBoard || null,
        nextFollowUp: f.nextFollowUp || null,
      };
      return enquiry ? api.updateEnquiry(enquiry.id, body) : api.createEnquiry(body);
    },
    onSuccess: onSaved,
  });
  return (
    <Modal
      title={enquiry ? `Edit enquiry – ${enquiry.childName}` : 'New admission enquiry'}
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
        <Field label="Child's name" className="sm:col-span-2">
          <Input value={f.childName} onChange={set('childName')} />
        </Field>
        <Field label="Gender">
          <Select value={f.gender} onChange={set('gender')} options={[['', '—'], ['M', 'Male'], ['F', 'Female'], ['O', 'Other']]} />
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={f.dob} onChange={set('dob')} />
        </Field>
        <Field label="Grade applying for">
          <Select value={f.grade} onChange={set('grade')} options={GRADES} />
        </Field>
        <Field label="For academic year">
          <Select value={yearId} onChange={set('academicYearId')} options={openYears.map((y): [string, string] => [y.id, y.label])} />
        </Field>
        {branches.length > 1 && (
          <Field label="Institution">
            <Select value={f.branchId} onChange={set('branchId')} options={branches.map((b): [string, string] => [b.id, b.name])} />
          </Field>
        )}
        <Field label="Parent name">
          <Input value={f.parentName} onChange={set('parentName')} />
        </Field>
        <Field label="Parent mobile">
          <Input type="tel" inputMode="numeric" value={f.parentPhone} onChange={set('parentPhone')} placeholder="98765 43210" />
        </Field>
        <Field label="Alternate mobile">
          <Input type="tel" inputMode="numeric" value={f.altPhone} onChange={set('altPhone')} />
        </Field>
        <Field label="Parent e-mail">
          <Input type="email" value={f.parentEmail} onChange={set('parentEmail')} />
        </Field>
        <Field label="Previous school">
          <Input value={f.previousSchool} onChange={set('previousSchool')} />
        </Field>
        <Field label="Previous board">
          <Select value={f.previousBoard} onChange={set('previousBoard')} options={[['', '—'], ...PREVIOUS_BOARDS.map((b): [string, string] => [b, b])]} />
        </Field>
        <Field label="How did you hear about us?">
          <Select value={f.source} onChange={set('source')} options={ENQUIRY_SOURCES.map((s): [string, string] => [s, s])} />
        </Field>
        <Field label="Next follow-up">
          <Input type="date" value={f.nextFollowUp} onChange={set('nextFollowUp')} />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Residential address" className="sm:col-span-2">
          <Input value={f.address} onChange={set('address')} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.siblingInSchool} onChange={set('siblingInSchool')} /> Sibling already in school
        </label>
      </div>
    </Modal>
  );
}

function DropForm({ e, onClose, onDone }: { e: EnquiryDetailDto; onClose: () => void; onDone: (e: EnquiryDetailDto) => void }) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.dropEnquiry(e.id, reason), onSuccess: onDone });
  return (
    <Modal
      title={`Drop ${e.childName}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={m.isPending || reason.trim().length < 3} onClick={() => m.mutate()}>
            Drop enquiry
          </Button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <Field label="Reason" hint="Kept for reporting. A dropped enquiry can be re-opened later.">
        <Input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Chose another school, fee concerns" autoFocus />
      </Field>
    </Modal>
  );
}

function EnrolForm({ e, onClose, onDone }: { e: EnquiryDetailDto; onClose: () => void; onDone: (e: EnquiryDetailDto) => void }) {
  const classes = useQuery({ queryKey: ['classes', e.branchId, e.academicYearId], queryFn: () => api.classes(e.branchId) });
  // Classes come back for the current year; only offer them when the enquiry is for that year.
  const options = (classes.data ?? []).filter((c) => c.academicYearId === e.academicYearId);
  const [classId, setClassId] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [relation, setRelation] = useState('Father');
  const [temporary, setTemporary] = useState(false);
  const m = useMutation({
    mutationFn: () => api.enrolEnquiry(e.id, { classId: classId || null, admissionNo: admissionNo || null, guardianRelation: relation, status: temporary ? 'Temporary' : 'Active' }),
    onSuccess: onDone,
  });
  return (
    <Modal
      title={`Enrol ${e.childName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Enrolling…' : 'Enrol'}
          </Button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <p className="mb-3 text-sm text-muted">
        Creates the student in {e.branchName} with {e.parentName} ({e.parentPhone}) as guardian. If that mobile is already on file, the child is linked to the existing family. Fee invoices will be added once the fees module is live.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Class" hint={options.length ? undefined : `No classes set up for ${e.academicYear} yet; assign one later`}>
          <Select value={classId} onChange={(ev) => setClassId(ev.target.value)} options={[['', '— assign later —'], ...options.map((c): [string, string] => [c.id, c.name])]} />
        </Field>
        <Field label="Admission no." hint="Leave blank to generate">
          <Input value={admissionNo} onChange={(ev) => setAdmissionNo(ev.target.value)} className="font-mono" />
        </Field>
        <Field label={`${e.parentName} is the child's`}>
          <Select value={relation} onChange={(ev) => setRelation(ev.target.value)} options={GUARDIAN_RELATIONS.map((r): [string, string] => [r, r])} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={temporary} onChange={(ev) => setTemporary(ev.target.checked)} /> Temporary admission (documents pending)
        </label>
      </div>
    </Modal>
  );
}
