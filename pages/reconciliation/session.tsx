import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import PageLayout from '../../src/components/PageLayout';
import { useRequireAuth } from '../../src/lib/auth';

export default function SessionPage() {
  const router = useRouter();
  useRequireAuth();
  const { sessionId } = router.query;
  const [session, setSession] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    fetch('/api/reconciliation/detail?sessionId=' + sessionId)
      .then((r) => r.json())
      .then((d) => {
        setSession(d.session);
        setLines(d.lines || []);
      })
      .catch(() => {});
  }, [sessionId]);

  if (!session) return <PageLayout title="التسوية"> <div>جارٍ التحميل...</div> </PageLayout>;

  return (
    <PageLayout title={`التسوية ${session.business_date}`}>
      <h2 className="text-xl font-semibold mb-4 text-right">{session.business_date} · {session.shift_code}</h2>
      <div className="space-y-3">
        {lines.map((l) => (
          <ReconciliationLine key={l.id} line={l} sessionId={session.id} />
        ))}
      </div>

      <div className="mt-6 text-right">
        <button className="bg-primary text-white px-4 py-2 rounded" onClick={async () => { const res = await fetch('/api/reconciliation/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: session.id }) }); const b = await res.json(); if (res.ok) alert('تم إرسال التسوية'); else alert(b.error || 'فشل'); }}>إرسال الجلسة</button>
      </div>
    </PageLayout>
  );
}

function ReconciliationLine({ line, sessionId }: { line: any; sessionId: string }) {
  const [value, setValue] = useState<string>(line.actual_closing_qty ? String(line.actual_closing_qty) : '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch('/api/reconciliation/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, tank_id: line.tank_id, actual_closing_qty: Number(value) }) });
    const b = await res.json();
    setSaving(false);
    if (!res.ok) alert(b.error || 'فشل الحفظ'); else alert('تم الحفظ');
  }

  return (
    <div className="p-3 bg-surface rounded shadow-sm text-right">
      <div className="font-medium">{line.tank_code} — {line.fuel_name}</div>
      <div className="text-sm text-muted">المتوقع: {line.expected_closing_qty} · الفارق الحالي: {line.variance_qty ?? '—'}</div>
      <div className="mt-2 flex gap-2 justify-end">
        <input value={value} onChange={(e) => setValue(e.target.value)} className="border rounded px-3 py-2 w-40 text-right" placeholder="الكمية الفعلية" />
        <button onClick={save} disabled={saving} className="bg-accent text-white px-3 py-2 rounded">حفظ</button>
      </div>
    </div>
  );
}
