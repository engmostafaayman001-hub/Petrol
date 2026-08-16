import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  try {
    const { session_id, tank_id, actual_closing_qty } = req.body || {}; const quantity = Number(actual_closing_qty);
    if (!uuid.test(String(session_id || '')) || !uuid.test(String(tank_id || ''))) return res.status(400).json({ error: 'معرّف الجلسة أو الخزان غير صالح.' });
    if (!Number.isFinite(quantity) || quantity < 0) return res.status(400).json({ error: 'الكمية الفعلية يجب أن تكون رقماً موجباً أو صفراً.' });
    const supabase = getServiceSupabase(); const { data: session, error: sessionError } = await supabase.from('reconciliation_sessions').select('status').eq('id', session_id).maybeSingle();
    if (sessionError) return res.status(400).json({ error: sessionError.message }); if (!session) return res.status(404).json({ error: 'جلسة التسوية غير موجودة.' }); if (session.status !== 'open') return res.status(409).json({ error: 'هذه الجلسة مغلقة بالفعل. افتح وردية جديدة لتسجيل قراءات جديدة.' });
    const { data, error } = await supabase.rpc('fn_record_closing_measurement', { p_session_id: session_id, p_tank_id: tank_id, p_quantity: quantity, p_source: 'manual', p_sensor_device_id: null, p_notes: null, p_raw: null });
    if (error) return res.status(400).json({ error: error.message, details: error.details ?? null, hint: error.hint ?? null }); return res.status(200).json({ result: data });
  } catch (error: any) { return res.status(500).json({ error: error.message || 'خطأ داخلي أثناء حفظ القراءة.' }); }
}
