import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NotificationDto, NotificationFeedDto } from '@sms/shared';
import { api } from '../api';
import { Badge, Button, C, ErrorText, Loading, Page, s } from '../ui';

const ICON: Record<string, string> = { announcement: '📢', receipt: '🧾', absence: '📅', fee_reminder: '⏰' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Where a notice leads inside the app. */
export type NoticeTarget = { tab: 'fees' | 'attendance' } | { receiptId: string } | null;
export const targetOf = (n: NotificationDto): NoticeTarget => {
  const m = n.link?.match(/^\/receipts\/(.+)$/);
  if (m) return { receiptId: m[1] };
  if (n.link === '/fees') return { tab: 'fees' };
  if (n.link === '/attendance') return { tab: 'attendance' };
  return null;
};

/**
 * Announcements from the school, receipts, absences and fee reminders, newest first (pinned on top).
 * Tapping a notice marks it read and opens what it is about; announcements expand in place.
 */
export function Notices({ feed, loading, error, reload, onOpen }: { feed: NotificationFeedDto | null; loading: boolean; error: string | null; reload: () => void; onOpen: (t: NoticeTarget) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !feed) return <Loading />;
  const tap = async (n: NotificationDto) => {
    if (!n.read) await api.markNotificationRead(n.id).catch(() => undefined);
    const t = targetOf(n);
    if (t) onOpen(t);
    else setOpen(open === n.id ? null : n.id);
    if (!n.read) reload();
  };
  return (
    <Page onRefresh={reload} refreshing={loading}>
      <ErrorText error={error} />
      {!!feed?.unread && <Button title={`Mark all ${feed.unread} as read`} variant="secondary" onPress={() => void api.markAllNotificationsRead().then(reload)} />}
      {feed && !feed.items.length && <Text style={[s.muted, { textAlign: 'center', marginTop: 24 }]}>No notices yet.</Text>}
      {feed?.items.map((n) => {
        const expanded = open === n.id || n.text.length <= 160;
        return (
          <Pressable key={n.id} accessibilityRole="button" aria-label={`${n.read ? '' : 'Unread: '}${n.title}`} onPress={() => void tap(n)} style={({ pressed }) => [s.card, { flexDirection: 'row', gap: 10, borderColor: n.read ? C.line : '#f6b98d', backgroundColor: n.read ? C.card : '#fff7f0' }, pressed && { opacity: 0.85 }]}>
            <Text style={{ fontSize: 20 }}>{n.pinned ? '📌' : (ICON[n.kind] ?? '🔔')}</Text>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Text style={[s.rowText, { fontWeight: n.read ? '600' : '800', flexShrink: 1 }]}>{n.title}</Text>
                {n.priority && n.priority !== 'Normal' && <Badge tone={n.priority === 'Urgent' ? 'red' : 'amber'}>{n.priority}</Badge>}
              </View>
              <Text style={{ color: C.ink, opacity: 0.85 }}>{expanded ? n.text : `${n.text.slice(0, 150)}… (tap to read)`}</Text>
              <Text style={s.muted}>{when(n.createdAt)}</Text>
            </View>
          </Pressable>
        );
      })}
    </Page>
  );
}
