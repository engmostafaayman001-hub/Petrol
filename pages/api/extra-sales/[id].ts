import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const stationId = String(req.query.stationId || '');
  const id = String(req.query.id || '');
  if (!uuid.test(stationId) || !uuid.test(id)) return res.status(400).json({ error: 'بيانات الفاتورة غير صالحة.' });

  try {
    await requireStationOperator(req, stationId);
    const { data, error } = await getServiceSupabase().from('extra_sales')
      .select('*')
      .eq('station_id', stationId).eq('id', id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'الفاتورة غير موجودة.' });
    return res.status(200).json({ sale: data });
  } catch (error: any) {
    return res.status(403).json({ error: error?.message || 'لا يمكن عرض الفاتورة.' });
  }
}
