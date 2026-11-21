import { useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, SafeAreaView, ScrollView, StatusBar as RNStatusBar, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { SessionUser } from '@sms/shared';
import { api, refreshSession, setSessionListener, type Child } from './src/api';
import { Attendance } from './src/screens/Attendance';
import { Fees } from './src/screens/Fees';
import { Home } from './src/screens/Home';
import { Login } from './src/screens/Login';
import { More } from './src/screens/More';
import { DevCheckout, PaymentResult } from './src/screens/Payment';
import { ReceiptDetail, Receipts } from './src/screens/Receipts';
import { Button, C, ErrorText, Loading, s, useLoad } from './src/ui';

/**
 * BNM School – parent app. Parents sign in with their mobile number and a code, then see each child's
 * fees, pay online, get receipts and follow attendance. Staff and students use the website.
 */
type Tab = 'home' | 'fees' | 'attendance' | 'receipts' | 'more';
type Screen = { name: 'checkout'; orderId: string } | { name: 'result'; orderId: string } | { name: 'receipt'; id: string };

const TABS: [Tab, string, string][] = [
  ['home', 'Home', '🏠'],
  ['fees', 'Fees', '₹'],
  ['attendance', 'Attendance', '📅'],
  ['receipts', 'Receipts', '🧾'],
  ['more', 'More', '☰'],
];
const TITLE: Record<Screen['name'], string> = { checkout: 'Online payment', result: 'Online payment', receipt: 'Receipt' };

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'signed-in' | 'signed-out' | 'offline'>('loading');

  useEffect(() => {
    setSessionListener((u) => {
      setUser(u);
      setStatus(u ? 'signed-in' : 'signed-out');
    });
    refreshSession().catch(() => setStatus('offline'));
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 }}>
      <StatusBar style="dark" />
      {status === 'loading' && <Loading />}
      {status === 'offline' && (
        <View style={s.page}>
          <ErrorText error="Can't reach the school's server. Check your internet connection." />
          <Button title="Try again" onPress={() => (setStatus('loading'), refreshSession().catch(() => setStatus('offline')))} />
        </View>
      )}
      {status === 'signed-out' && <Login />}
      {status === 'signed-in' && user && (user.role === 'parent' ? <ParentApp user={user} /> : <NotForYou user={user} />)}
    </SafeAreaView>
  );
}

function NotForYou({ user }: { user: SessionUser }) {
  return (
    <View style={s.page}>
      <Text style={s.h1}>Hello, {user.name}</Text>
      <Text style={s.muted}>This app is for parents. Staff use the school's website.</Text>
      <Button title="Sign out" variant="secondary" onPress={() => void api.logout()} />
    </View>
  );
}

function ParentApp({ user }: { user: SessionUser }) {
  const kids = useLoad(() => api.children(), []);
  const [childId, setChildId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [stack, setStack] = useState<Screen[]>([]);
  const push = (sc: Screen) => setStack((st) => [...st, sc]);
  const back = () => setStack((st) => st.slice(0, -1));
  const screen = stack[stack.length - 1];

  // Android back button: close the open screen before leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) {
        back();
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab]);

  if (kids.loading && !kids.data) return <Loading />;
  const children = kids.data ?? [];
  const child: Child | undefined = children.find((c) => c.id === childId) ?? children[0];

  if (!child) {
    return (
      <View style={s.page}>
        <ErrorText error={kids.error} />
        <Text style={s.h1}>Hello, {user.name.split(' ')[0]}</Text>
        <Text style={s.muted}>No student is linked to this mobile number yet. Please contact the school office.</Text>
        <Button title="Try again" variant="secondary" onPress={kids.reload} />
        <Button title="Sign out" variant="secondary" onPress={() => void api.logout()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header: back button on inner screens; child switcher on the tabs. */}
      <View style={{ backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
        {screen ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" aria-label="Back" onPress={back} hitSlop={12}>
              <Text style={{ fontSize: 22, color: C.brand }}>‹</Text>
            </Pressable>
            <Text style={s.cardTitle}>{TITLE[screen.name]}</Text>
          </View>
        ) : (
          <>
            <Text style={s.muted}>Hello, {user.name.split(' ')[0]}</Text>
            {children.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 6 }}>
                {children.map((c) => {
                  const on = c.id === child.id;
                  return (
                    <Pressable key={c.id} accessibilityRole="tab" aria-selected={on} onPress={() => setChildId(c.id)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? C.brand : C.grayBg }}>
                      <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '700' }}>
                        {c.name.split(' ')[0]}
                        {c.className ? ` · ${c.className}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Text style={s.cardTitle}>
                {child.name}
                {child.className ? ` · ${child.className}` : ''}
              </Text>
            )}
          </>
        )}
      </View>

      <View style={{ flex: 1 }}>
        {screen?.name === 'checkout' && <DevCheckout orderId={screen.orderId} onDone={() => setStack((st) => [...st.slice(0, -1), { name: 'result', orderId: screen.orderId }])} onCancel={back} />}
        {screen?.name === 'result' && <PaymentResult orderId={screen.orderId} onReceipt={(id) => push({ name: 'receipt', id })} onBack={() => (setStack([]), setTab('fees'))} />}
        {screen?.name === 'receipt' && <ReceiptDetail id={screen.id} />}
        {!screen && tab === 'home' && <Home key={child.id} child={child} onPay={() => setTab('fees')} onAttendance={() => setTab('attendance')} />}
        {!screen && tab === 'fees' && <Fees key={child.id} child={child} onCheckout={(orderId) => push({ name: 'checkout', orderId })} onResult={(orderId) => push({ name: 'result', orderId })} />}
        {!screen && tab === 'attendance' && <Attendance key={child.id} child={child} />}
        {!screen && tab === 'receipts' && <Receipts key={child.id} child={child} onOpen={(id) => push({ name: 'receipt', id })} />}
        {!screen && tab === 'more' && <More user={user} onSignOut={() => void api.logout()} />}
      </View>

      {!screen && (
        <View style={{ flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, paddingBottom: Platform.OS === 'ios' ? 4 : 0 }} accessibilityRole="tablist">
          {TABS.map(([t, label, icon]) => {
            const on = t === tab;
            return (
              <Pressable key={t} accessibilityRole="tab" aria-label={label} aria-selected={on} onPress={() => setTab(t)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{ fontSize: 18, color: on ? C.brand : C.muted }}>{icon}</Text>
                <Text style={{ fontSize: 11, fontWeight: on ? '700' : '500', color: on ? C.brand : C.muted }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
