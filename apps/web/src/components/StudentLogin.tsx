import { useMutation, useQueryClient } from '@tanstack/react-query';
import { STUDENT_PASSWORD_MIN, type StudentLoginStatus } from '@sms/shared';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Badge, Button, ErrorBox, Input } from './ui';

/**
 * A student's sign-in: shows the login ID and lets a parent (or the school office) set a password
 * or turn the sign-in off. Students sign in on the Student tab with the login ID and this password.
 */
export function StudentLoginPanel({ status, showName }: { status: StudentLoginStatus; showName?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);

  const refresh = (s: StudentLoginStatus) => {
    qc.setQueryData(['student-login', s.studentId], s);
    void qc.invalidateQueries({ queryKey: ['my-student-logins'] });
  };
  const save = useMutation({
    mutationFn: () => api.setStudentPassword(status.studentId, password),
    onSuccess: (s) => {
      refresh(s);
      setEditing(false);
      setPassword('');
      setConfirm('');
      setDone(`Password saved. ${s.studentName.split(' ')[0]} signs in on the Student tab with login ID ${s.loginId} and this password.`);
    },
  });
  const disable = useMutation({
    mutationFn: () => api.disableStudentLogin(status.studentId),
    onSuccess: (s) => {
      refresh(s);
      setDone('Sign-in turned off. Set a new password to turn it back on.');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMismatch(password !== confirm);
    if (password === confirm) save.mutate();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {showName && (
          <b className="mr-1">
            {status.studentName} {status.className && <span className="font-normal text-muted">· {status.className}</span>}
          </b>
        )}
        {status.enabled ? <Badge tone="green">Sign-in on</Badge> : <Badge>{status.loginId ? 'Sign-in off' : 'No sign-in yet'}</Badge>}
        {status.loginId && (
          <span className="text-sm">
            Login ID <b className="font-mono">{status.loginId}</b>
          </span>
        )}
        {status.enabled && <span className="text-sm text-muted">· last signed in {status.lastLoginAt ? new Date(status.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</span>}
      </div>

      {editing ? (
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <label className="text-xs font-semibold text-muted">
            New password
            <Input type="password" autoComplete="new-password" minLength={STUDENT_PASSWORD_MIN} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-muted">
            Type it again
            <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save password'}
          </Button>
          <Button type="button" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <p className="text-xs text-muted sm:col-span-4">At least {STUDENT_PASSWORD_MIN} characters. Saving signs the student out everywhere else.</p>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={status.enabled ? 'default' : 'primary'}
            onClick={() => {
              setEditing(true);
              setDone(null);
            }}
          >
            {status.enabled ? 'Change password' : status.loginId ? 'Turn on with a new password' : 'Set up sign-in'}
          </Button>
          {status.enabled && (
            <Button onClick={() => confirm_(`Turn off ${status.studentName}'s sign-in?`) && disable.mutate()} disabled={disable.isPending}>
              Turn off
            </Button>
          )}
        </div>
      )}
      {mismatch && <p className="text-sm text-red-700">The two passwords don't match.</p>}
      {done && <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800">{done}</p>}
      {(save.error || disable.error) && <ErrorBox error={save.error ?? disable.error} />}
    </div>
  );
}

const confirm_ = (msg: string) => window.confirm(msg);
