import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const { session_id, meter_id, opening_reading, reason } = req.body || {};
  if (!session_id || !meter_id || !Number.isFinite(Number(opening_reading)) || Number(opening_reading) < 0 || typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'القراءة الجديدة وسبب التعديل مطلوبان.' });
  try {
    const db = getServiceSupabase();
    const { data: session } = await db.from('reconciliation_sessions').select('station_id,status').eq('id', session_id).maybeSingle();
    if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة.' });
    const actor = await requireStationManager(req, session.station_id);
    const { data, error } = await db.rpc('fn_manager_update_opening_meter', { p_session_id: session_id, p_meter_id: meter_id, p_opening_reading: Number(opening_reading), p_reason: reason.trim(), p_actor_id: actor.id });
    if (error) return res.status(/المدير فقط|صلاحية|permission|insufficient/i.test(error.message) ? 403 : 400).json({ error: error.message });
    return res.status(200).json({ reading: data });
  } catch (error: any) { return res.status(400).json({ error: error.message || 'تعذر تعديل القراءة.' }); }
}