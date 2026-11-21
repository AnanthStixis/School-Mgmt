import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

/** The POC's colours. */
export const C = {
  brand: '#e8650a',
  brandDark: '#c9540a',
  bg: '#f3f5fa',
  card: '#ffffff',
  ink: '#18223a',
  muted: '#6a7691',
  line: '#e4e8f1',
  green: '#15803d',
  greenBg: '#dcfce7',
  amber: '#92400e',
  amberBg: '#fef3c7',
  red: '#b91c1c',
  redBg: '#fee2e2',
  blue: '#1d4ed8',
  blueBg: '#dbeafe',
  grayBg: '#eef1f6',
};

export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Loads data once and on pull-to-refresh; `reload` re-runs it. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void run(), [run]);
  return { data, error, loading, reload: run };
}

/** A scrolling page with pull-to-refresh. */
export function Page({ children, onRefresh, refreshing = false }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={s.page} refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[C.brand]} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Card({ title, right, children, style }: { title?: string; right?: ReactNode; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[s.card, style]}>
      {(title || right) && (
        <View style={s.cardHead}>
          {title && <Text style={s.cardTitle}>{title}</Text>}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray';
const TONES: Record<Tone, [string, string]> = { green: [C.greenBg, C.green], amber: [C.amberBg, C.amber], red: [C.redBg, C.red], blue: [C.blueBg, C.blue], gray: [C.grayBg, C.muted] };
export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  const [bg, fg] = TONES[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, busy }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      aria-label={title}
      aria-disabled={!!(disabled || busy)}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, primary ? s.btnPrimary : s.btnSecondary, variant === 'danger' && { borderColor: C.red }, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {busy ? <ActivityIndicator color={primary ? '#fff' : C.brand} /> : <Text style={[s.btnText, { color: primary ? '#fff' : variant === 'danger' ? C.red : C.ink }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput aria-label={label} placeholderTextColor="#9aa3b8" {...p} style={[s.input, p.style]} />
    </View>
  );
}

export const Loading = () => (
  <View style={{ padding: 32 }}>
    <ActivityIndicator color={C.brand} size="large" />
  </View>
);

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <View style={s.error}>
      <Text style={{ color: C.red }}>{error}</Text>
    </View>
  );
}

export function Row({ left, right, sub, onPress }: { left: ReactNode; right?: ReactNode; sub?: ReactNode; onPress?: () => void }) {
  const body = (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        {typeof left === 'string' ? <Text style={s.rowText}>{left}</Text> : left}
        {sub ? typeof sub === 'string' ? <Text style={s.muted}>{sub}</Text> : sub : null}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: C.bg }}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

export const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  h1: { fontSize: 22, fontWeight: '800', color: C.ink },
  muted: { color: C.muted, fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, backgroundColor: '#fff', color: C.ink },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  btn: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnPrimary: { backgroundColor: C.brand, borderColor: C.brand },
  btnSecondary: { backgroundColor: '#fff', borderColor: C.line },
  btnText: { fontSize: 15, fontWeight: '700' },
  error: { backgroundColor: C.redBg, borderRadius: 10, padding: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  rowText: { fontSize: 15, color: C.ink },
  big: { fontSize: 24, fontWeight: '800', color: C.ink },
});
