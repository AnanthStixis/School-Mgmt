import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ONLINE_MODES, PAYMENT_STATUS_LABEL, type DevOutcome, type PaymentStatus } from '@sms/shared';
import { api } from '../api';
import { Badge, Button, C, Card, ErrorText, inr, Loading, Page, Row, s, useLoad } from '../ui';

const TONE: Record<PaymentStatus, 'gray' | 'amber' | 'green' | 'red'> = { INITIATED: 'gray', PENDING: 'amber', SUCCESS: 'green', FAILED: 'red' };

/**
 * The development payment gateway, inside the app: choose what the bank answers. A real gateway
 * (not chosen yet) opens its own page instead, and this screen is never shown.
 */
export function DevCheckout({ orderId, onDone, onCancel }: { orderId: string; onDone: () => void; onCancel: () => void }) {
  const q = useLoad(() => api.payment(orderId), [orderId]);
  const [mode, setMode] = useState<string>('UPI');
  const [busy, setBusy] = useState<DevOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (o: DevOutcome) => {
    setBusy(o);
    setError(null);
    try {
      await api.devCompletePayment(orderId, o, mode);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (q.loading && !q.data) return <Loading />;
  const a = q.data;
  return (
    <Page>
      <View style={{ backgroundColor: C.amberBg, borderRadius: 10, padding: 10 }}>
        <Text style={{ color: C.amber }}>🧪 Development payment gateway. No money moves; choose what the bank answers.</Text>
      </View>
      <ErrorText error={q.error ?? error} />
      {a && (
        <Card title={`Pay ${inr(a.amount)}`}>
          <Text style={[s.muted, { marginBottom: 6 }]}>
            {a.studentName} · order {a.orderId}
          </Text>
          {a.lines.map((l) => (
            <Row key={l.invoiceId} left={l.label} sub={l.fine ? `includes late fee ${inr(l.fine)}` : undefined} right={<Text style={s.rowText}>{inr(l.fee + l.fine)}</Text>} />
          ))}
          <Text style={[s.label, { marginTop: 12 }]}>Pay with</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {ONLINE_MODES.map((m) => (
              <Pressable key={m} accessibilityRole="radio" aria-checked={m === mode} onPress={() => setMode(m)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: m === mode ? C.brand : C.line, backgroundColor: m === mode ? '#fff4ec' : '#fff' }}>
                <Text style={{ color: m === mode ? C.brandDark : C.ink, fontWeight: '600' }}>{m}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 8 }}>
            <Button title={`✓ Pay ${inr(a.amount)}`} busy={busy === 'success'} disabled={!!busy} onPress={() => answer('success')} />
            <Button title="Bank declines" variant="secondary" busy={busy === 'declined'} disabled={!!busy} onPress={() => answer('declined')} />
            <Button title="Bank is slow (pending)" variant="secondary" busy={busy === 'pending'} disabled={!!busy} onPress={() => answer('pending')} />
            <Button title="Cancel" variant="secondary" disabled={!!busy} onPress={onCancel} />
          </View>
        </Card>
      )}
    </Page>
  );
}

/** What happened to an online payment. Checks again every 5 seconds while the bank hasn't answered. */
export function PaymentResult({ orderId, onReceipt, onBack }: { orderId: string; onReceipt: (id: string) => void; onBack: () => void }) {
  const q = useLoad(() => api.payment(orderId), [orderId]);
  const waiting = q.data?.status === 'PENDING' || q.data?.status === 'INITIATED';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void q.reload(), 5000);
    return () => clearInterval(t);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.loading && !q.data) return <Loading />;
  const a = q.data;
  const msg: Record<PaymentStatus, string> = {
    SUCCESS: a ? `Payment of ${inr(a.amount)} received. Thank you!` : '',
    FAILED: `The payment did not go through${a?.message ? ` (${a.message})` : ''}. No money was taken; you can try again.`,
    PENDING: 'Your bank has not confirmed the payment yet. This screen updates by itself. Please don’t pay again meanwhile.',
    INITIATED: 'The payment was not completed.',
  };
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <ErrorText error={q.error} />
      {a && (
        <Card>
          <Badge tone={TONE[a.status]}>{PAYMENT_STATUS_LABEL[a.status]}</Badge>
          <Text style={[s.rowText, { fontSize: 17, marginVertical: 12 }]}>{msg[a.status]}</Text>
          <Text style={s.muted}>
            {a.studentName} · order {a.orderId}
            {a.gatewayTxnId ? `\nTransaction ${a.gatewayTxnId}` : ''}
          </Text>
          {a.excess > 0 && <Text style={[s.muted, { color: C.amber, marginTop: 8 }]}>{inr(a.excess)} of this was already paid; the school office will refund it.</Text>}
          <View style={{ gap: 8, marginTop: 16 }}>
            {a.receiptId && <Button title={`Receipt ${a.receiptNo}`} onPress={() => onReceipt(a.receiptId!)} />}
            <Button title="Back to fees" variant="secondary" onPress={onBack} />
          </View>
        </Card>
      )}
    </Page>
  );
}
