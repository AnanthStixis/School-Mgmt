import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_LABEL, type AttendanceStatus, type RegisterDto, type StudentAttendanceDto } from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';

const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const STATUS_STYLE: Record<AttendanceStatus, string> = { P: 'bg-green-600 text-white', A: 'bg-red-600 text-white', L: 'bg-amber-500 text-white' };
const DOT: Record<AttendanceStatus, string> = { P: 'bg-green-100 text-green-800', A: 'bg-red-100 text-red-800', L: 'bg-amber-100 text-amber-800' };

export function Attendance() {
  const { user } = useAuth();
  if (user?.role === 'parent' || user?.role === 'student') return <FamilyView />;
  return <StaffView />;
}

function StaffView() {
  const { isManager } = useScope();
  const [tab, setTab] = useState<'mark' | 'overview'>('mark');
  return (
    <div>
      <PageHeader title="Attendance" sub="Daily register, absence alerts to parents and attendance analytics" />
      {isManager && (
        <Tabs
          items={[
            ['mark', 'Mark attendance'],
            ['overview', 'Overview'],
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === 'mark' ? <MarkRegister /> : <Overview />}
    </div>
  );
}

function MarkRegister() {
  const qc = useQueryClient();
  const { branchId } = useScope();
  const classes = useQuery({ queryKey: ['att-classes'], queryFn: api.attendanceClasses });
  const visible = (classes.data ?? []).filter((c) => !branchId || c.branchId === branchId);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayIST());
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [result, setResult] = useState<string | null>(null);

  // Default to the caller's own class, else the first one.
  useEffect(() => {
    if (visible.length && !visible.some((c) => c.id === classId)) setClassId((visible.find((c) => c.isMyClass) ?? visible[0]).id);
  }, [visible, classId]);

  const reg = useQuery({ queryKey: ['register', classId, date], queryFn: () => api.register(classId, date), enabled: !!classId });
  useEffect(() => {
    if (reg.data) setMarks(Object.fromEntries(reg.data.entries.map((e) => [e.studentId, e.status ?? 'P'])));
  }, [reg.data]);
  // The "saved" message stays after the register reloads; it clears when another class or day is opened.
  useEffect(() => setResult(null), [classId, date]);

  const save = useMutation({
    mutationFn: (r: RegisterDto) => api.saveRegister({ classId: r.classId, date: r.date, entries: r.entries.map((e) => ({ studentId: e.studentId, status: marks[e.studentId] ?? 'P' })) }),
    onSuccess: (r) => {
      setResult(`Saved: ${r.present} present, ${r.absent} absent, ${r.leave} on leave.${r.alertsSent ? ` Absence SMS sent to ${r.alertsSent} parent(s).` : ''}`);
      void qc.invalidateQueries({ queryKey: ['register', classId, date] });
      void qc.invalidateQueries({ queryKey: ['att-classes'] });
      void qc.invalidateQueries({ queryKey: ['att-overview'] });
    },
  });

  const counts = useMemo(() => {
    const c = { P: 0, A: 0, L: 0 } as Record<AttendanceStatus, number>;
    for (const v of Object.values(marks)) c[v]++;
    return c;
  }, [marks]);

  if (classes.isLoading) return <Loading />;
  if (!visible.length)
    return (
      <Card>
        <p className="text-muted">You have no classes to take attendance for. Class teachers are set in Academic Setup → Classes.</p>
      </Card>
    );
  const r = reg.data;
  const editable = !!r?.canEdit;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Class"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="max-w-xs"
            options={visible.map((c): [string, string] => [c.id, `${c.name}${c.isMyClass ? ' (my class)' : ''}${c.submittedToday ? ' ✓' : ''}${branchId ? '' : ` · ${c.branchName.replace('BNM ', '')}`}`])}
          />
          <Input aria-label="Date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} className="max-w-[11rem]" />
          <span className="flex-1" />
          {r?.submitted ? <Badge tone="green">Submitted by {r.submitted.by ?? '—'}</Badge> : <Badge tone="amber">Not submitted</Badge>}
        </div>
        {r && !editable && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{r.editNote}</p>}
      </Card>
      <ErrorBox error={reg.error ?? save.error} />
      {result && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">✅ {result}</p>}
      {reg.isLoading ? (
        <Loading />
      ) : (
        r && (
          <Card
            title={
              <span className="flex flex-wrap gap-2">
                {r.className} <Badge tone="green">{counts.P} present</Badge> <Badge tone="red">{counts.A} absent</Badge> <Badge tone="amber">{counts.L} leave</Badge>
              </span>
            }
            actions={
              editable && (
                <>
                  <Button onClick={() => setMarks(Object.fromEntries(r.entries.map((e) => [e.studentId, 'P'])))}>All present</Button>
                  <Button variant="primary" disabled={save.isPending || !r.entries.length} onClick={() => save.mutate(r)}>
                    {save.isPending ? 'Saving…' : r.submitted ? 'Save changes' : 'Submit & alert parents'}
                  </Button>
                </>
              )
            }
          >
            <Table
              rows={r.entries}
              rowKey={(e) => e.studentId}
              empty="No students in this class"
              columns={[
                { header: 'Roll', cell: (e) => e.rollNo ?? '—' },
                { header: 'Student', cell: (e) => <b>{e.name}</b> },
                {
                  header: 'Year %',
                  cell: (e) => (e.percent === null ? '—' : <Badge tone={e.percent < 75 ? 'red' : e.percent < 85 ? 'amber' : 'green'}>{e.percent}%</Badge>),
                },
                {
                  header: date === todayIST() ? 'Today' : date,
                  cell: (e) => (
                    <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label={`Attendance for ${e.name}`}>
                      {(['P', 'A', 'L'] as AttendanceStatus[]).map((s) => (
                        <button
                          key={s}
                          role="radio"
                          aria-checked={marks[e.studentId] === s}
                          disabled={!editable}
                          onClick={() => setMarks({ ...marks, [e.studentId]: s })}
                          className={`px-2.5 py-1 text-xs font-semibold ${marks[e.studentId] === s ? STATUS_STYLE[s] : 'bg-white text-muted hover:bg-bg'}`}
                        >
                          {ATTENDANCE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        )
      )}
    </div>
  );
}

function Overview() {
  const { branchId, isTenantWide } = useScope();
  const q = useQuery({ queryKey: ['att-overview', branchId], queryFn: () => api.attendanceOverview(branchId || undefined) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-card border border-line bg-card p-3">
          <div className="text-2xl font-bold">{o.todayPresentPercent === null ? '—' : `${o.todayPresentPercent}%`}</div>
          <div className="text-xs text-muted">Present today</div>
        </div>
        <div className="rounded-card border border-line bg-card p-3">
          <div className="text-2xl font-bold">{o.pendingToday}</div>
          <div className="text-xs text-muted">Registers not submitted today</div>
        </div>
        <div className="rounded-card border border-line bg-card p-3">
          <div className="text-2xl font-bold">{o.atRisk.length}</div>
          <div className="text-xs text-muted">Students below threshold</div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title={`Class-wise (since ${o.from})`}>
          <Table
            rows={o.classes}
            rowKey={(r) => r.classId}
            columns={[
              { header: 'Class', cell: (r) => <b>{r.className}</b> },
              ...(isTenantWide && !branchId ? [{ header: 'Branch', cell: (r: { branchName: string }) => r.branchName.replace('BNM ', '') }] : []),
              { header: 'Average', cell: (r) => (r.average === null ? '—' : `${r.average}%`) },
              {
                header: 'Last 5 days',
                cell: (r) => (
                  <span className="flex gap-1">
                    {r.recent.map((d) => (
                      <span key={d.date} title={d.date}>
                        <Badge tone={d.percent >= 90 ? 'green' : d.percent >= 80 ? 'amber' : 'red'}>{Math.round(d.percent)}</Badge>
                      </span>
                    ))}
                  </span>
                ),
              },
              { header: 'Below threshold', cell: (r) => r.belowThreshold || '—' },
              { header: 'Today', cell: (r) => (r.submittedToday ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">Pending</Badge>) },
            ]}
          />
        </Card>
        <Card title="At risk (below threshold)">
          <Table
            rows={o.atRisk}
            rowKey={(s) => s.studentId}
            empty="No students below the threshold 🎉"
            columns={[
              { header: 'Student', cell: (s) => <Link to={`/students/${s.studentId}`}>{s.name}</Link> },
              { header: 'Class', cell: (s) => s.className },
              { header: '%', cell: (s) => <Badge tone="red">{s.percent}%</Badge> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}

function FamilyView() {
  const kids = useQuery({ queryKey: ['my-students'], queryFn: api.myStudents });
  const [idx, setIdx] = useState(0);
  const kid = kids.data?.[idx];
  return (
    <div>
      <PageHeader title="Attendance" sub="Day-by-day attendance for this academic year" />
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
      {kid ? <StudentAttendance studentId={kid.id} /> : !kids.isLoading && <p className="text-muted">No student linked to this account.</p>}
    </div>
  );
}

/** Summary + calendar for one student; also shown on the student profile. */
export function StudentAttendance({ studentId, compact }: { studentId: string; compact?: boolean }) {
  const q = useQuery({ queryKey: ['student-att', studentId], queryFn: () => api.studentAttendance(studentId) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const a = q.data;
  const months = groupByMonth(a);
  const shown = compact ? months.slice(-2) : months;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone={a.percent === null ? 'gray' : a.percent < a.threshold ? 'red' : 'green'}>{a.percent === null ? 'No days marked' : `${a.percent}% present`}</Badge>
        <Badge tone="green">{a.counts.P} present</Badge>
        <Badge tone="red">{a.counts.A} absent</Badge>
        <Badge tone="amber">{a.counts.L} leave</Badge>
      </div>
      {a.percent !== null && a.percent < a.threshold && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">⚠ Below the {a.threshold}% attendance requirement.</p>
      )}
      {shown.map(([month, days]) => (
        <div key={month}>
          <h4 className="mb-1 text-sm font-semibold">{month}</h4>
          <div className="flex flex-wrap gap-1">
            {days.map((d) => (
              <span key={d.date} title={`${d.date}: ${ATTENDANCE_LABEL[d.status]}`} className={`grid size-8 place-items-center rounded text-xs font-semibold ${DOT[d.status]}`}>
                {Number(d.date.slice(8))}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function groupByMonth(a: StudentAttendanceDto): [string, StudentAttendanceDto['days']][] {
  const m = new Map<string, StudentAttendanceDto['days']>();
  for (const d of a.days) {
    const key = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    m.set(key, [...(m.get(key) ?? []), d]);
  }
  return [...m.entries()];
}
