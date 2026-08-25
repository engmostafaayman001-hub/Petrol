import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['POST', 'PATCH'].includes(req.method || '')) return res.status(405).end();
  try {
    const { id, ...payload } = req.body || {};
    if (!payload.station_id || !payload.code || !payload.name || !payload.fuel_type_id) return res.status(400).json({ error: 'بيانات الخزان الأساسية غير مكتملة.' });
    const meterReadingsCount = Number(payload.meter_readings_count ?? 1);
    if (!Number.isInteger(meterReadingsCount) || meterReadingsCount < 1 || meterReadingsCount > 20) return res.status(400).json({ error: 'عدد قراءات العداد يجب أن يكون رقمًا صحيحًا من 1 إلى 20.' });
    payload.meter_readings_count = meterReadingsCount;
    const actor = await requireStationOperator(req, payload.station_id);
    const supabase = getServiceSupabase();
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', actor.id).eq('station_id', payload.station_id).eq('is_active', true).maybeSingle();
    if (profile?.role !== 'manager') return res.status(403).json({ error: 'إدارة الخزانات متاحة للمدير فقط.' });
    const query = req.method === 'PATCH' && id ? supabase.from('tanks').update(payload).eq('id', id).eq('station_id', payload.station_id) : supabase.from('tanks').insert({ ...payload, created_by: actor.id });
    const { data, error } = await query.select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ tank: data });
  } catch (error: any) { return res.status(500).json({ error: error.message || 'تعذر حفظ الخزان.' }); }
}
