import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_SMS_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  AUDIENCE_LABEL,
  type AnnouncementAudience,
  type AnnouncementDto,
  type AnnouncementPriority,
  type NotificationDto,
} from '@sms/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select } from '../components/ui';

const PRIORITY_TONE: Record<AnnouncementPriority, 'gray' | 'amber' | 'red'> = { Normal: 'gray', Important: 'amber', Urgent: 'red' };
const KIND_ICON: Record<string, string> = { announcement: '📢', receipt: '🧾', absence: '📅', fee_reminder: '⏰' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

// ======================= bell and feed =======================

/** Bell in the header with the number of unread notices; checks every minute. */
export function NotificationBell() {
  const q = useQuery({ queryKey: ['notifications'], queryFn: api.notifications, refetchInterval: 60_000 });
  const n = q.data?.unread ?? 0;
  return (
    <Link to="/notifications" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'} className="relative rounded-lg border border-line px-2.5 py-1.5 text-ink no-underline hover:bg-bg">
      🔔
      {n > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-brand px-1 text-center text-xs font-bold text-white">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}

export function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: refresh });
  const open = async (n: NotificationDto) => {
    if (!n.read) await api.markNotificationRead(n.id).then(refresh).catch(() => undefined);
    if (n.link) nav(n.link);
  };
  return (
    <div>
      <PageHeader
        title="Notifications"
        sub="Announcements from the school, payment receipts, absences and fee reminders."
        actions={
          <Button disabled={!q.data?.unread || readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all as read
          </Button>
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : !q.data ? (
        <ErrorBox error={q.error} />
      ) : !q.data.items.length ? (
        <Card>
          <p className="py-6 text-center text-muted">Nothing yet.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {q.data.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => void open(n)} className={`flex w-full gap-3 rounded-card border p-3 text-left hover:bg-bg ${n.read ? 'border-line bg-card' : 'border-brand/40 bg-orange-50/60'}`}>
                <span className="text-xl" aria-hidden>
                  {n.pinned ? '📌' : (KIND_ICON[n.kind] ?? '🔔')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className={n.read ? 'font-semibold' : 'font-bold'}>{n.title}</b>
                    {n.priority && n.priority !== 'Normal' && <Badge tone={PRIORITY_TONE[n.priority]}>{n.priority}</Badge>}
                    {!n.read && <span className="sr-only">(unread)</span>}
                  </span>
                  <span className="mt-0.5 block text-sm whitespace-pre-line text-ink/80">{n.text}</span>
                  <span className="mt-1 block text-xs text-muted">{when(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ======================= communication (announcements) =======================

export function Communication() {
  const { user } = useAuth();
  const writer = user?.role === 'manager' || user?.role === 'teacher';
  return (
    <div>
      <PageHeader title="Communication" sub={writer ? 'Announcements to parents and staff: in the app and website, and optionally by SMS and e-mail.' : 'Announcements from the school.'} />
      <div className="space-y-4">
        {writer && <Composer />}
        <AnnouncementList writer={writer} />
      </div>
    </div>
  );
}

function Composer() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { branchId, isTenantWide } = useScope();
  const teacher = user?.role === 'teacher';
  const channels = useQuery({ queryKey: ['channels'], queryFn: api.channels });
  const classes = useQuery({ queryKey: ['attendance-classes'], queryFn: api.attendanceClasses });
  const empty = { title: '', body: '', audience: (teacher ? 'CLASSES' : 'PARENTS') as AnnouncementAudience, classIds: [] as string[], priority: 'Normal' as AnnouncementPriority, pinned: false, sms: false, email: false };
  const [f, setF] = useState(empty);
  const [done, setDone] = useState<AnnouncementDto | null>(null);
  // School Admin with no branch picked writes to every branch.
  const target = branchId ?? (isTenantWide ? null : user?.branchId ?? null);
  const myClasses = (classes.data ?? []).filter((c) => !target || c.branchId === target);

  const audience = { branchId: target, audience: f.audience, classIds: f.audience === 'CLASSES' ? f.classIds : undefined, sms: f.sms, email: f.email };
  const ready = f.audience !== 'CLASSES' || f.classIds.length > 0;
  const preview = useQuery({ queryKey: ['ann-preview', audience], queryFn: () => api.previewAnnouncement(audience), enabled: ready });
  useEffect(() => setF((x) => ({ ...x, classIds: x.classIds.filter((id) => myClasses.some((c) => c.id === id)) })), [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => api.sendAnnouncement({ ...f, branchId: target, classIds: f.audience === 'CLASSES' ? f.classIds : undefined }),
    onSuccess: (a) => {
      setDone(a);
      setF(empty);
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const p = preview.data;
  const smsPreview = `${(target && myClasses[0]?.branchName) || 'BNM'}: ${f.title} - ${f.body.replace(/\s+/g, ' ')}`;

  return (
    <Card title="New announcement">
      {done && (
        <p className="mb-3 rounded-lg bg-green-50 p-2 text-sm text-green-800">
          ✅ Sent “{done.title}” to {done.recipients} people{done.sms ? ` · ${done.smsSent} SMS` : ''}
          {done.email ? ` · ${done.emailSent} e-mails` : ''}.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm(`Send “${f.title}” to ${p?.recipients ?? '?'} people${f.sms ? `, with ${p?.sms ?? '?'} SMS` : ''}?`)) send.mutate();
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="To" className="sm:col-span-2">
            <Select
              value={f.audience}
              disabled={teacher}
              onChange={(e) => setF({ ...f, audience: e.target.value as AnnouncementAudience })}
              options={(teacher ? (['CLASSES'] as AnnouncementAudience[]) : (Object.keys(AUDIENCE_LABEL) as AnnouncementAudience[])).map((a): [string, string] => [a, teacher ? 'Parents of my class' : AUDIENCE_LABEL[a]])}
            />
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as AnnouncementPriority })} options={ANNOUNCEMENT_PRIORITIES.map((x): [string, string] => [x, x])} />
          </Field>
        </div>
        {!teacher && <p className="text-xs text-muted">Branch: {target ? myClasses[0]?.branchName ?? 'the selected branch' : 'all branches'} (change it with the branch switcher at the top).</p>}
        {f.audience === 'CLASSES' && (
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-muted">Classes</legend>
            <div className="flex flex-wrap gap-2">
              {myClasses.map((c) => {
                const on = f.classIds.includes(c.id);
                return (
                  <label key={c.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${on ? 'border-brand bg-orange-50 font-semibold' : 'border-line'}`}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => setF({ ...f, classIds: on ? f.classIds.filter((x) => x !== c.id) : [...f.classIds, c.id] })} />
                    {c.name}
                    {isTenantWide && !target ? ` · ${c.branchName}` : ''}
                  </label>
                );
              })}
              {!myClasses.length && <span className="text-sm text-muted">{teacher ? 'You are not a class teacher of any class.' : 'No classes in this branch.'}</span>}
            </div>
          </fieldset>
        )}
        <Field label="Title">
          <Input required minLength={3} maxLength={ANNOUNCEMENT_TITLE_MAX} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Sports day on 5 December" />
        </Field>
        <Field label="Message" hint={`${f.body.length}/${ANNOUNCEMENT_BODY_MAX}`}>
          <textarea required rows={5} maxLength={ANNOUNCEMENT_BODY_MAX} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className="w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-brand" />
        </Field>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to the top
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.sms} onChange={(e) => setF({ ...f, sms: e.target.checked })} /> Also send by SMS
          </label>
          <label className={`flex items-center gap-2 ${channels.data?.email ? '' : 'text-muted'}`} title={channels.data?.email ? undefined : 'E-mail is not set up on this system yet'}>
            <input type="checkbox" disabled={!channels.data?.email} checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} /> Also send by e-mail
          </label>
        </div>
        {f.sms && (
          <p className="rounded-lg bg-bg p-2 text-xs text-muted">
            SMS (primary parent of each child{f.audience === 'STAFF' || f.audience === 'EVERYONE' ? ', and staff' : ''}): “{smsPreview.length > ANNOUNCEMENT_SMS_MAX ? `${smsPreview.slice(0, ANNOUNCEMENT_SMS_MAX - 30)}… Read more in the parent app.` : smsPreview}”
          </p>
        )}
        {channels.data?.simulated && (f.sms || f.email) && <p className="text-xs text-amber-800">This is a development or test system: SMS and e-mails are written to the server log, not sent.</p>}
        <ErrorBox error={send.error ?? preview.error} />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
          {p && ready && (
            <span className="text-sm text-muted">
              Reaches <b className="text-ink">{p.recipients}</b> people ({p.parents} parents{p.students ? `, ${p.students} students` : ''}
              {p.staff ? `, ${p.staff} staff` : ''}){f.sms ? ` · ${p.sms} SMS` : ''}
              {f.email ? ` · ${p.email} e-mails` : ''}
            </span>
          )}
          <Button type="submit" variant="primary" disabled={!ready || !p?.recipients || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send announcement'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AnnouncementList({ writer }: { writer: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['announcements'], queryFn: api.announcements });
  const withdraw = useMutation({
    mutationFn: api.withdrawAnnouncement,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <Card title={writer ? 'Sent' : 'Announcements'}>
      <ErrorBox error={withdraw.error} />
      {!q.data.length && <p className="py-4 text-center text-muted">No announcements yet.</p>}
      <ul className="divide-y divide-line">
        {q.data.map((a) => (
          <li key={a.id} className={`py-3 ${a.withdrawnAt ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              {a.pinned && !a.withdrawnAt && <span aria-label="Pinned">📌</span>}
              <b className={a.withdrawnAt ? 'line-through' : ''}>{a.title}</b>
              {a.priority !== 'Normal' && <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>}
              {a.withdrawnAt && <Badge tone="red">Withdrawn</Badge>}
            </div>
            <p className="mt-1 text-sm whitespace-pre-line">{a.body}</p>
            <p className="mt-1 text-xs text-muted">
              {when(a.createdAt)} · {a.createdByName}
              {writer && (
                <>
                  {' '}
                  · {a.audienceLabel} · {a.recipients} recipients, {a.read} read{a.sms ? ` · ${a.smsSent} SMS` : ''}
                  {a.email ? ` · ${a.emailSent} e-mails` : ''}
                </>
              )}
            </p>
            {writer && !a.withdrawnAt && (a.createdByName === user?.name || user?.role === 'manager') && (
              <button className="mt-1 text-xs font-semibold text-red-700" disabled={withdraw.isPending} onClick={() => confirm(`Withdraw “${a.title}”? It disappears from everyone's notifications. SMS and e-mails already sent can't be recalled.`) && withdraw.mutate(a.id)}>
                Withdraw
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
