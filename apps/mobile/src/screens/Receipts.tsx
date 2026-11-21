import { Text, View } from 'react-native';
import { api, type Child } from '../api';
import { Badge, Card, ErrorText, inr, Loading, Page, Row, s, useLoad } from '../ui';

/** Every receipt for the child, newest first: counter and online payments. */
export function Receipts({ child, onOpen }: { child: Child; onOpen: (id: string) => void }) {
  const q = useLoad(() => api.receipts(child.id), [child.id]);
  if (q.loading && !q.data) return <Loading />;
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <ErrorText error={q.error} />
      <Card>
        {q.data && !q.data.length && <Text style={s.muted}>No receipts yet.</Text>}
        {q.data?.map((r) => (
          <Row
            key={r.id}
            onPress={() => onOpen(r.id)}
            left={<Text style={[s.rowText, r.status === 'CANCELLED' && { textDecorationLine: 'line-through' }]}>{r.no}</Text>}
            sub={`${r.date} · ${r.mode}${r.source === 'Online' ? ' (online)' : ''}`}
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[s.rowText, { fontWeight: '700' }]}>{inr(r.total)}</Text>
                {r.status === 'CANCELLED' ? <Badge tone="red">Cancelled</Badge> : r.recon === 'PENDING' ? <Badge tone="amber">Awaiting bank</Badge> : <Badge tone="green">Paid</Badge>}
              </View>
            }
          />
        ))}
      </Card>
    </Page>
  );
}

/** One receipt, as printed by the school. */
export function ReceiptDetail({ id }: { id: string }) {
  const q = useLoad(() => api.receipt(id), [id]);
  if (q.loading && !q.data) return <Loading />;
  const r = q.data;
  return (
    <Page onRefresh={q.reload} refreshing={q.loading}>
      <ErrorText error={q.error} />
      {r && (
        <Card>
          <Text style={s.muted}>{r.branchName}</Text>
          <Text style={[s.h1, { marginVertical: 4 }]}>{r.no}</Text>
          {r.status === 'CANCELLED' && (
            <View style={{ marginBottom: 8 }}>
              <Badge tone="red">Cancelled{r.cancelReason ? `: ${r.cancelReason}` : ''}</Badge>
            </View>
          )}
          <Text style={s.muted}>
            {r.date} · {r.studentName} ({r.admissionNo}) · {r.className ?? '—'} · {r.academicYear}
          </Text>
          <View style={{ marginTop: 10 }}>
            {r.lines.map((l) => (
              <Row
                key={l.invoiceId}
                left={l.label}
                sub={[l.fine ? `includes late fee ${inr(l.fine)}` : '', l.fineWaived ? `late fee ${inr(l.fineWaived)} waived` : ''].filter(Boolean).join(' · ') || undefined}
                right={<Text style={[s.rowText, { fontWeight: '700' }]}>{inr(l.fee + l.fine)}</Text>}
              />
            ))}
            <Row left={<Text style={[s.rowText, { fontWeight: '800' }]}>Total</Text>} right={<Text style={[s.rowText, { fontWeight: '800' }]}>{inr(r.total)}</Text>} />
          </View>
          <Text style={[s.muted, { fontStyle: 'italic', marginTop: 8 }]}>{r.amountInWords}</Text>
          <Text style={[s.muted, { marginTop: 8 }]}>
            Paid by {r.mode}
            {r.bank ? ` · ${r.bank}` : ''}
            {r.instrumentNo ? ` · No. ${r.instrumentNo}` : ''}
            {r.reference ? ` · Ref ${r.reference}` : ''}
            {r.recon === 'PENDING' ? ' (subject to realisation)' : ''}
          </Text>
          {r.refunds.map((f) => (
            <Text key={f.id} style={[s.muted, { marginTop: 4 }]}>
              Refunded {inr(f.amount)} on {f.date} by {f.mode}
            </Text>
          ))}
          <Text style={[s.muted, { marginTop: 12, fontSize: 11 }]}>Computer-generated receipt; no signature required.</Text>
        </Card>
      )}
    </Page>
  );
}
