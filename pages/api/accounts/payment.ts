import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager } from '../../../src/lib/reconciliationAuth';
import { parseNumericInput } from '../../../src/core/numbers';

// Payments are the only account-ledger rows that may be directly changed.
// Sales and deliveries are changed through their operational records so their
// inventory/accounting side effects stay consistent.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = String(req.query.id || req.body?.id || '').trim();
  const stationId = String(req.query.stationId || req.body?.station_id || '').trim();
  if (!id || !stationId) return res.status(400).json({ error: 'معرف الحركة والمحطة مطلوبان.' });
  if (!['PATCH', 'DELETE'].includes(req.method || '')) return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  try {
    await requireStationManager(req, stationId);
    const db = getServiceSupabase();
    const { data: payment, error: paymentError } = await db.from('account_transactions').select('id,station_id,transaction_type').eq('id', id).eq('station_id', stationId).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment || !['customer_payment', 'supplier_payment'].includes(payment.transaction_type)) return res.status(404).json({ error: 'هذه الحركة ليست تحصيلًا أو دفعة قابلة للتعديل.' });
    if (req.method === 'DELETE') {
      const { error } = await db.from('account_transactions').delete().eq('id', id).eq('station_id', stationId);
      if (error) throw error;
      return res.status(200).json({ deleted: true });
    }
    const amount = parseNumericInput(req.body?.amount) ?? NaN;
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'أدخل مبلغًا صحيحًا.' });
    const update = payment.transaction_type === 'customer_payment' ? { credit: amount, debit: 0 } : { debit: amount, credit: 0 };
    const { error } = await db.from('account_transactions').update(update).eq('id', id).eq('station_id', stationId);
    if (error) throw error;
    return res.status(200).json({ updated: true });
  } catch (error: any) {
    return res.status(/المدير|صلاحية|insufficient/i.test(error.message || '') ? 403 : 400).json({ error: error.message || 'تعذر تعديل حركة الحساب.' });
  }
}
