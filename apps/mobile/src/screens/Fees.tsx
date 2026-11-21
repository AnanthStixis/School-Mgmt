import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { InvoiceStatus } from '@sms/shared';
import { api, type Child } from '../api';
import { Badge, Button, C, Card, ErrorText, inr, Loading, Page, Row, s, useLoad } from '../ui';

const TONE: Record<InvoiceStatus, 'green' | 'amber' | 'red' | 'blue'> = { Paid: 'green', Partial: 'amber', Overdue: 'red', Pending: 'blue' };
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Published fees, installment by installment, and "Pay online" for whole installments
 * (balance + today's late fee) of fees the school has switched online payment on for.
 */
export function Fees({ child, onCheckout, onResult, onReceipts }: { child: Child; onCheckout: (orderId: string) => void; onResult: (orderId: string) => void; onReceipts: () => void }) {
  const q = useLoad(() => api.fees(child.id), [child.id]);
  const payable = useMemo(
    () => (q.data?.assignments ?? []).filter((a) => a.onlineEnabled).flatMap((a) => a.invoices.filter((i) => i.balance > 0).map((i) => ({ ...i, feeTypeName: a.feeTypeName }))),
    [q.data],
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  // Tick everything due by today (or the next installment when nothing is due yet).
  useEffect(() => {
    const due = payable.filter((i) => i.dueDate <= today());
    setChosen(new Set((due.length ? due : payable.slice(0, 1)).map((i) => i.id)));
  }, [payable]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = payable.filter((i) => chosen.has(i.id)).reduce((n, i) => n + i.balance + i.lateFee, 0);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.startPayment(child.id, [...chosen]);
      if (r.gateway === 'dev') onCheckout(r.orderId);
      else {
        // A real gateway's page opens in an in-app browser; the result screen then waits for the bank's answer.
        await WebBrowser.openBrowserAsync(r.checkoutUrl);
        onResult(r.orderId);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (q.loading && !q.data) return <Loading />;
  const f = q.data;
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <ErrorText error={q.error} />
      {f && (
        <>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge>Billed {inr(f.totals.gross)}</Badge>
            <Badge tone="green">Paid {inr(f.totals.paid)}</Badge>
            <Badge tone={f.totals.balance ? 'amber' : 'green'}>Balance {inr(f.totals.balance)}</Badge>
            {f.totals.overdue > 0 && <Badge tone="red">Overdue {inr(f.totals.overdue)}</Badge>}
          </View>
          <Button title="🧾  Receipts" variant="secondary" onPress={onReceipts} />

          {payable.length > 0 && (
            <Card title="Pay online">
              {payable.map((i) => {
                const on = chosen.has(i.id);
                return (
                  <Pressable
                    key={i.id}
                    accessibilityRole="checkbox"
                    aria-checked={on}
                    aria-label={`${i.feeTypeName} ${i.label}, ${inr(i.balance + i.lateFee)}`}
                    onPress={() => {
                      const n = new Set(chosen);
                      if (on) n.delete(i.id);
                      else n.add(i.id);
                      setChosen(n);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }}
                  >
                    <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowText}>
                        {i.feeTypeName} · {i.label}
                      </Text>
                      <Text style={s.muted}>
                        due {i.dueDate}
                        {i.lateFee > 0 ? ` · late fee ${inr(i.lateFee)}` : ''}
                      </Text>
                    </View>
                    <Text style={[s.rowText, { fontWeight: '700' }]}>{inr(i.balance + i.lateFee)}</Text>
                  </Pressable>
                );
              })}
              <ErrorText error={error} />
              <View style={{ height: 8 }} />
              <Button title={`Pay ${inr(total)}`} disabled={!chosen.size} busy={busy} onPress={pay} />
              <Text style={[s.muted, { marginTop: 8, textAlign: 'center' }]}>UPI, cards or net banking. The receipt comes by SMS.</Text>
            </Card>
          )}

          {!f.assignments.length && <Text style={s.muted}>No fees have been published yet.</Text>}
          {f.assignments.map((a) => (
            <Card key={a.id} title={a.feeTypeName}>
              <Text style={[s.muted, { marginBottom: 4 }]}>
                {a.category} · {a.academicYear}
              </Text>
              {a.invoices.map((i) => (
                <Row
                  key={i.id}
                  left={i.label}
                  sub={`due ${i.dueDate}${i.concession ? ` · concession ${inr(i.concession)}` : ''}${i.paid ? ` · paid ${inr(i.paid)}` : ''}${i.lateFee ? ` · late fee ${inr(i.lateFee)}` : ''}`}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[s.rowText, { fontWeight: '700' }]}>{inr(Math.max(0, i.balance) || i.gross)}</Text>
                      <Badge tone={TONE[i.status]}>{i.status}</Badge>
                    </View>
                  }
                />
              ))}
              {!a.onlineEnabled && a.totals.balance > 0 && <Text style={[s.muted, { marginTop: 8 }]}>Pay this one at the school office.</Text>}
            </Card>
          ))}
        </>
      )}
    </Page>
  );
}
