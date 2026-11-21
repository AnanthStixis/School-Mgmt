import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { STUDENT_PASSWORD_MIN, type SessionUser, type StudentLoginStatus } from '@sms/shared';
import { api } from '../api';
import { API_URL } from '../config';
import { Badge, Button, Card, ErrorText, Field, Loading, Page, s, useLoad } from '../ui';

/** Account, children's own sign-in (set by the parent, as the DPDP Act expects), and sign out. */
export function More({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const q = useLoad(() => api.childLogins(), []);
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <Card title="Signed in">
        <Text style={s.rowText}>{user.name}</Text>
        <Text style={s.muted}>{user.title}</Text>
      </Card>
      <Card title="Your children's sign-in">
        <Text style={[s.muted, { marginBottom: 8 }]}>Children sign in on the school website's Student tab with their admission number and a password you choose here. You can change it or turn it off any time.</Text>
        {q.loading && !q.data ? <Loading /> : <ErrorText error={q.error} />}
        {q.data?.map((c) => <ChildLogin key={c.studentId} c={c} onChange={q.reload} />)}
      </Card>
      <Button title="Sign out" variant="danger" onPress={onSignOut} />
      <Text style={[s.muted, { textAlign: 'center', fontSize: 11 }]}>Connected to {API_URL}</Text>
    </Page>
  );
}

function ChildLogin({ c, onChange }: { c: StudentLoginStatus; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<StudentLoginStatus>, ok: (r: StudentLoginStatus) => string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setDone(ok(r));
      setEditing(false);
      setPw('');
      setPw2('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = () => {
    const go = () => run(() => api.disableChildLogin(c.studentId), () => 'Sign-in turned off.');
    if (Platform.OS === 'web') return void go();
    Alert.alert('Turn off sign-in?', `${c.studentName} won't be able to sign in until you set a new password.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn off', style: 'destructive', onPress: go }]);
  };
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: '#e4e8f1', paddingTop: 10, marginTop: 4, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={[s.rowText, { fontWeight: '700' }]}>
          {c.studentName}
          {c.className ? ` · ${c.className}` : ''}
        </Text>
        <Badge tone={c.enabled ? 'green' : 'gray'}>{c.enabled ? 'Sign-in on' : c.loginId ? 'Sign-in off' : 'No sign-in yet'}</Badge>
      </View>
      {c.loginId && <Text style={s.muted}>Login ID {c.loginId}</Text>}
      {editing ? (
        <>
          <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
          <Field label="Type it again" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" />
          <Text style={s.muted}>At least {STUDENT_PASSWORD_MIN} characters.</Text>
          {pw2.length > 0 && pw !== pw2 && <ErrorText error="The two passwords don't match." />}
          <Button title="Save password" busy={busy} disabled={pw.length < STUDENT_PASSWORD_MIN || pw !== pw2} onPress={() => run(() => api.setChildPassword(c.studentId, pw), (r) => `Saved. ${r.studentName.split(' ')[0]} signs in with login ID ${r.loginId}.`)} />
          <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title={c.enabled ? 'Change password' : 'Set up sign-in'} variant={c.enabled ? 'secondary' : 'primary'} onPress={() => (setEditing(true), setDone(null))} />
          </View>
          {c.enabled && (
            <View style={{ flex: 1 }}>
              <Button title="Turn off" variant="secondary" busy={busy} onPress={turnOff} />
            </View>
          )}
        </View>
      )}
      <ErrorText error={error} />
      {done && <Text style={{ color: '#15803d' }}>{done}</Text>}
    </View>
  );
}
