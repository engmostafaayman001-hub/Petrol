import type { NextApiRequest, NextApiResponse } from 'next';
import { getRequestSupabase } from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const stationId = String(req.query.stationId || '');
  if (!stationId) return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
  const supabase = getRequestSupabase(req);
  if (!supabase) return res.status(401).json({ error: 'يجب تسجيل الدخول.' });
  const { data, error } = await supabase.rpc('fn_current_open_services', { p_station_id: stationId });
  if (error) {
    if (error.code === 'PGRST202') return res.status(503).json({ error: 'ميزة الخدمات غير مفعلة بعد. طبّق آخر migrations على قاعدة Supabase ثم أعد المحاولة.' });
    return res.status(400).json({ error: error.message });
  }
  return res.status(200).json(data || { session: null, services: [], total: 0, count: 0 });
}
