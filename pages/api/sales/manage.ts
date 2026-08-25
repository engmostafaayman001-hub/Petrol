import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const saleId = String(req.query.id || req.body?.id || '').trim();
  if (!saleId) return res.status(400).json({ error: 'معرف المبيعة مطلوب.' });
  try {
    const db = getServiceSupabase();
    const { data: sale, error } = await db.from('sales').select('station_id').eq('id', saleId).maybeSingle();
    if (error) throw error;
    if (!sale) return res.status(404).json({ error: 'المبيعة غير موجودة.' });
    const actor = await requireStationManager(req, sale.station_id);
    if (req.method === 'DELETE') {
      const reason = String(req.body?.reason || 'حذف إداري').trim();
      const { error: voidError } = await db.from('sales').update({ status: 'voided', void_reason: reason, voided_by: actor.id, voided_at: new Date().toISOString() }).eq('id', saleId).eq('station_id', sale.station_id).eq('status', 'active');
      if (voidError) return res.status(400).json({ error: voidError.message });
      return res.status(200).json({ voided: true });
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
    const payload = req.body?.payload || req.body || {};
    const reason = String(req.body?.reason || '').trim();
    const { data, error: updateError } = await db.rpc('fn_manager_replace_sale', { p_sale_id: saleId, p_payload: payload, p_reason: reason, p_actor: actor.id });
    if (updateError) return res.status(400).json({ error: updateError.message });
    return res.status(200).json({ sale_id: data });
  } catch (error: any) {
    const message = error.message || 'تعذر تعديل المبيعة.';
    return res.status(/المدير|insufficient|صلاحية/i.test(message) ? 403 : 500).json({ error: message });
  }
}
