import { Text, View } from 'react-native';
import type { AttendanceStatus } from '@sms/shared';
import { api, type Child } from '../api';
import { Badge, C, Card, ErrorText, Loading, Page, s, useLoad } from '../ui';

const COLOR: Record<AttendanceStatus, string> = { P: C.green, A: C.red, L: C.amber };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Attendance percentage and a month-by-month calendar (green present, red absent, amber leave). */
export function Attendance({ child }: { child: Child }) {
  const q = useLoad(() => api.attendance(child.id), [child.id]);
  if (q.loading && !q.data) return <Loading />;
  const a = q.data;
  const byDate = new Map((a?.days ?? []).map((d) => [d.date, d.status]));
  // Months covered, newest first.
  const months: { y: number; m: number }[] = [];
  if (a) {
    let d = new Date(`${a.to.slice(0, 7)}-01T00:00:00Z`);
    const start = new Date(`${a.from.slice(0, 7)}-01T00:00:00Z`);
    while (d >= start) {
      months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    }
  }
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <ErrorText error={q.error} />
      {a && (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={s.muted}>Attendance since {a.from}</Text>
                <Text style={[s.big, { color: a.percent != null && a.percent < a.threshold ? C.red : C.ink }]}>{a.percent != null ? `${a.percent}%` : '—'}</Text>
              </View>
              {a.percent != null && a.percent < a.threshold && <Badge tone="red">Below {a.threshold}%</Badge>}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Badge tone="green">{a.counts.P} present</Badge>
              <Badge tone="red">{a.counts.A} absent</Badge>
              <Badge tone="amber">{a.counts.L} leave</Badge>
            </View>
          </Card>
          {months.map(({ y, m }) => {
            const first = new Date(Date.UTC(y, m, 1));
            const lead = (first.getUTCDay() + 6) % 7; // Monday first
            const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
            const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
            return (
              <Card key={`${y}-${m}`} title={`${MONTHS[m]} ${y}`}>
                <View style={{ flexDirection: 'row' }}>
                  {DAYS.map((d, i) => (
                    <Text key={i} style={[s.muted, { width: `${100 / 7}%`, textAlign: 'center', fontWeight: '700' }]}>
                      {d}
                    </Text>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {cells.map((day, i) => {
                    const date = day ? `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                    const st = day ? byDate.get(date) : undefined;
                    return (
                      <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }}>
                        {day && (
                          <View
                            aria-label={`${date}: ${st === 'P' ? 'present' : st === 'A' ? 'absent' : st === 'L' ? 'leave' : 'no record'}`}
                            style={{ flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: st ? COLOR[st] : C.grayBg }}
                          >
                            <Text style={{ color: st ? '#fff' : C.muted, fontWeight: '600', fontSize: 13 }}>{day}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}
