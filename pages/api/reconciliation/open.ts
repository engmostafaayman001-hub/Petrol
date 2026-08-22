import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { station_id, shift_id, opening_meters, opening_tanks } = req.body ?? {};
    if (!station_id) {
      return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
    }
    if (!shift_id || !Array.isArray(opening_meters) || !Array.isArray(opening_tanks)) {
      return res.status(400).json({ error: 'اختر نوع الوردية وسجل جميع قراءات العدادات والخزانات.' });
    }

    const operator = await requireStationOperator(req, station_id);
    const supabase = getServiceSupabase();

    const { data, error } = await supabase.rpc('fn_open_reconciliation', {
      p_station_id: station_id,
      p_shift_id: shift_id,
      p_opening_meters: opening_meters,
      p_opening_tanks: opening_tanks,
      p_operator_id: operator.id,
    });

    if (error) {
      console.error('fn_open_reconciliation error:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
      const status = error.code === '23505' ? 409 : 400;
      return res.status(status).json({ error: error.message || 'تعذر فتح الجلسة.', details: error.details ?? null, hint: error.hint ?? null });
    }

    return res.status(200).json({ result: data });
  } catch (err: any) {
    console.error('reconciliation/open error:', err);
    return res.status(400).json({ error: err?.message || 'بيانات فتح الجلسة غير صحيحة.' });
  }
}
