import { Text, View } from 'react-native';
import { api, type Child } from '../api';
import { Badge, Button, C, Card, ErrorText, inr, Loading, Page, s, useLoad } from '../ui';

/** One child at a glance: what's owed, what's overdue, attendance, and the next due date. */
export function Home({ child, onPay, onAttendance }: { child: Child; onPay: () => void; onAttendance: () => void }) {
  const q = useLoad(() => Promise.all([api.fees(child.id), api.attendance(child.id)]), [child.id]);
  if (q.loading && !q.data) return <Loading />;
  const [fees, att] = q.data ?? [null, null];
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const next = fees?.assignments
    .flatMap((a) => a.invoices.filter((i) => i.balance > 0).map((i) => ({ ...i, fee: a.feeTypeName })))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const lateFees = fees?.assignments.flatMap((a) => a.invoices).reduce((n, i) => n + i.lateFee, 0) ?? 0;
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <ErrorText error={q.error} />
      {fees && (
        <Card title="Fees">
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 10 }}>
            <View>
              <Text style={s.muted}>To pay</Text>
              <Text style={s.big}>{inr(fees.totals.balance + lateFees)}</Text>
            </View>
            {fees.totals.overdue > 0 && (
              <View>
                <Text style={s.muted}>Overdue</Text>
                <Text style={[s.big, { color: C.red }]}>{inr(fees.totals.overdue)}</Text>
              </View>
            )}
          </View>
          {lateFees > 0 && <Text style={[s.muted, { color: C.red, marginBottom: 8 }]}>Includes late fees of {inr(lateFees)} (₹25 a day after the due date).</Text>}
          {next ? (
            <Text style={[s.muted, { marginBottom: 12 }]}>
              {next.dueDate < today ? 'Oldest unpaid' : 'Next due'}: {next.fee} · {next.label}, {inr(next.balance)} {next.dueDate < today ? 'was due' : 'due'} {next.dueDate}
            </Text>
          ) : (
            <Text style={[s.muted, { marginBottom: 12 }]}>Nothing to pay right now. 🎉</Text>
          )}
          {fees.totals.balance > 0 && <Button title="Pay fees" onPress={onPay} />}
        </Card>
      )}
      {att && (
        <Card title="Attendance" right={att.percent != null ? <Badge tone={att.percent < att.threshold ? 'red' : 'green'}>{att.percent}%</Badge> : undefined}>
          <Text style={[s.muted, { marginBottom: 12 }]}>
            {att.counts.P} present · {att.counts.A} absent · {att.counts.L} on leave since {att.from}
            {att.percent != null && att.percent < att.threshold ? `\nBelow the school's ${att.threshold}% requirement.` : ''}
          </Text>
          <Button title="See calendar" variant="secondary" onPress={onAttendance} />
        </Card>
      )}
    </Page>
  );
}
