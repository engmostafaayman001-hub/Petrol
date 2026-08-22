import type { NextApiRequest, NextApiResponse } from 'next';
import { getRequestSupabase } from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const stationId = String(req.query.stationId || '');
  const serviceId = String(req.query.serviceId || '');
  if (!stationId || !serviceId) return res.status(400).json({ error: 'معرف المحطة والخدمة مطلوبان.' });
  const supabase = getRequestSupabase(req);
  if (!supabase) return res.status(401).json({ error: 'يجب تسجيل الدخول.' });
  const { data, error } = await supabase.rpc('fn_current_open_service_detail', { p_station_id: stationId, p_service_id: serviceId });
  if (error) {
    if (error.code === 'PGRST202') return res.status(503).json({ error: 'ميزة الخدمات غير مفعلة بعد. طبّق آخر migrations على قاعدة Supabase ثم أعد المحاولة.' });
    return res.status(400).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'الخدمة غير موجودة ضمن الجلسة المفتوحة الحالية.' });
  return res.status(200).json({ service: data });
}
