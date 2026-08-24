import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, approved, reviewer_id } = req.body;
    if (!id || typeof approved === 'undefined') return res.status(400).json({ error: 'id and approved required' });
    const supabase = getServiceSupabase();
    const { data: adjustment, error: lookupError } = await supabase.from('adjustments').select('station_id').eq('id', id).maybeSingle();
    if (lookupError) return res.status(500).json({ error: lookupError.message });
    if (!adjustment) return res.status(404).json({ error: 'التعديل غير موجود.' });
    const actor = await requireStationManager(req, adjustment.station_id);
    const { data, error } = await supabase.from('adjustments').update({ status: approved ? 'approved' : 'rejected', decided_by: actor.id, decided_at: new Date().toISOString() }).eq('id', id).select().limit(1).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ adjustment: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
