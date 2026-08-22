import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  try {
    const { station_id, session_id, category, description, amount } = req.body || {};
    const value = Number(amount);
    if (!station_id || !session_id || typeof category !== 'string' || typeof description !== 'string' || !Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: 'أكمل الجلسة والتصنيف والوصف والمبلغ الصحيح.' });
    }
    const operator = await requireStationOperator(req, station_id);
    const { data, error } = await getServiceSupabase().rpc('fn_create_expense', {
      p_station_id: station_id,
      p_session_id: session_id,
      p_category: category,
      p_description: description,
      p_amount: value,
      p_actor_id: operator.id,
    });
    if (error) return res.status(error.code === '42501' ? 403 : error.code === 'restrict_violation' ? 409 : 400).json({ error: error.message });
    return res.status(201).json({ expense_id: data });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'تعذر حفظ المصروف.' });
  }
}
