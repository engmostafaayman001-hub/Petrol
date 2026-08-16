import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['POST', 'PATCH'].includes(req.method || '')) return res.status(405).end();
  try {
    const { id, ...payload } = req.body || {};
    if (!payload.station_id || !payload.code || !payload.name || !payload.fuel_type_id) return res.status(400).json({ error: 'بيانات الخزان الأساسية غير مكتملة.' });
    const supabase = getServiceSupabase();
    const query = req.method === 'PATCH' && id ? supabase.from('tanks').update(payload).eq('id', id) : supabase.from('tanks').insert(payload);
    const { data, error } = await query.select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ tank: data });
  } catch (error: any) { return res.status(500).json({ error: error.message || 'تعذر حفظ الخزان.' }); }
}
