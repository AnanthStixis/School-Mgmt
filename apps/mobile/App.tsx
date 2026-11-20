import { useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ROLE_LABEL, modulesFor, type Role } from '@sms/shared';

/** The mobile app serves these three personas (see Poc/mobile.html). */
const APP_ROLES: Role[] = ['parent', 'student', 'teacher'];

const C = { brand: '#e8650a', bg: '#f3f5fa', ink: '#18223a', muted: '#6a7691', line: '#e4e8f1' };

export default function App() {
  const [role, setRole] = useState<Role>('parent');
  const mods = modulesFor(role).filter((m) => m.key !== 'dashboard');

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.body}>
        <Image source={require('./assets/bnm-logo.png')} style={s.logo} resizeMode="contain" />
        <Text style={s.h1}>Development build</Text>
        <Text style={s.muted}>Pick a persona to preview its menu. Real sign-in comes with the auth module.</Text>

        <View style={s.seg}>
          {APP_ROLES.map((r) => (
            <Pressable key={r} onPress={() => setRole(r)} style={[s.segBtn, r === role && s.segOn]}>
              <Text style={[s.segTxt, r === role && s.segTxtOn]}>{ROLE_LABEL[r]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.grid}>
          {mods.map((m) => (
            <View key={m.key} style={s.tile}>
              <Text style={s.tileTxt}>{m.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { padding: 16, paddingTop: 40 },
  logo: { width: '100%', height: 70, marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: '700', color: C.ink },
  muted: { color: C.muted, marginTop: 4, marginBottom: 16 },
  seg: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 3, marginBottom: 16 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segOn: { backgroundColor: C.brand },
  segTxt: { color: C.ink, fontWeight: '600' },
  segTxtOn: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '47%', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14 },
  tileTxt: { color: C.ink, fontWeight: '600' },
});
