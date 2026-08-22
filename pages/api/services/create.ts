import type { NextApiRequest, NextApiResponse } from 'next';
import { getRequestSupabase } from '../../../src/lib/supabaseServer';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const { station_id, service_type, service_name, vehicle_type, amount, operator_id } = req.body || {};
  if (!uuid.test(String(station_id || ''))) return res.status(400).json({ error: 'معرف المحطة غير صالح.' });
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'المبلغ يجب أن يكون رقمًا أكبر من صفر.' });
  if (service_type === 'other' && !String(service_name || '').trim()) return res.status(400).json({ error: 'اكتب اسم الخدمة عند اختيار أخرى.' });
  const supabase = getRequestSupabase(req);
  if (!supabase) return res.status(401).json({ error: 'يجب تسجيل الدخول لإضافة خدمة.' });
  const { data, error } = await supabase.rpc('fn_create_service_sale', {
    p_station_id: station_id,
    p_service_type: service_type,
    p_service_name: service_type === 'other' ? String(service_name).trim() : null,
    p_vehicle_type: String(vehicle_type || '').trim() || null,
    p_amount: value,
    p_operator_id: operator_id || null,
  });
  if (error) {
    if (error.code === 'PGRST202') return res.status(503).json({ error: 'ميزة الخدمات غير مفعلة بعد. طبّق آخر migrations على قاعدة Supabase ثم أعد المحاولة.' });
    return res.status(400).json({ error: error.message });
  }
  return res.status(201).json({ service: data });
}
