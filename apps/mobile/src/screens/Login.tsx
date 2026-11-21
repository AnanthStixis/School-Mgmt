import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api } from '../api';
import { Button, C, ErrorText, Field, s } from '../ui';

/** Parents sign in with the mobile number registered with the school and a 6-digit code sent by SMS. */
export function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Image source={require('../../assets/bnm-logo.png')} style={{ width: '100%', height: 70, marginBottom: 16 }} resizeMode="contain" aria-label="BNM Public School" />
          <Text style={[s.h1, { marginBottom: 4 }]}>Parent sign in</Text>
          <Text style={[s.muted, { marginBottom: 16 }]}>Use the mobile number you gave the school.</Text>
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="98765 43210" editable={!sent} maxLength={16} />
          {sent && (
            <>
              <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} autoFocus style={{ letterSpacing: 6, fontSize: 20 }} />
              <Text style={[s.muted, { marginBottom: 12 }]}>If this number is registered with the school, we have sent a code by SMS. It expires in 5 minutes.</Text>
            </>
          )}
          <ErrorText error={error} />
          <View style={{ height: 8 }} />
          {!sent ? (
            <Button title="Send code" busy={busy} disabled={phone.replace(/\D/g, '').length < 10} onPress={() => run(async () => (await api.requestOtp(phone), setSent(true)))} />
          ) : (
            <>
              <Button title="Verify & sign in" busy={busy} disabled={code.length !== 6} onPress={() => run(() => api.verifyOtp(phone, code))} />
              <View style={{ height: 8 }} />
              <Button
                title="Use a different number"
                variant="secondary"
                onPress={() => {
                  setSent(false);
                  setCode('');
                  setError(null);
                }}
              />
            </>
          )}
        </View>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 16 }]}>Staff and students use the school's website.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
