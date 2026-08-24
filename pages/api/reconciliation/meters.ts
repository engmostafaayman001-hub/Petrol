import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const stationId = String(req.query.stationId || '');
  if (!stationId) return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
  try { await requireStationOperator(req, stationId); } catch (error: any) { return res.status(401).json({ error: error.message }); }
  const { data, error } = await getServiceSupabase()
    .from('pump_meters')
    .select('id, code, name, tank_id, tanks(code, name, fuel_type_id, fuel_types(name))')
    .eq('station_id', stationId)
    .eq('is_active', true)
    .order('code');
  if (error) {
    if (error.code === 'PGRST205' || /pump_meters|relation .* does not exist/i.test(error.message || '')) {
      return res.status(503).json({ error: 'ميزة عدادات الطلمبات غير مفعلة بعد. طبّق آخر migrations على قاعدة Supabase ثم أعد المحاولة.' });
    }
    return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ meters: data || [] });
}
