import React, { useEffect, useState } from 'react';
import PageLayout from '../../src/components/PageLayout';

export default function LedgerPage() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/ledger')
      .then((r) => r.json())
      .then((d) => setRows(d.rows || []))
      .catch(() => {});
  }, []);

  return (
    <PageLayout title="السجل العام">
      <h2 className="text-xl font-semibold mb-4 text-right">قائمة القيود (السجل)</h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="p-3 bg-surface rounded shadow-sm text-right">
            <div className="font-medium">{r.entry_date} · {r.entry_type}</div>
            <div className="text-sm text-muted">الوصف: {r.description} · المبلغ: {r.amount ?? '—'}</div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
