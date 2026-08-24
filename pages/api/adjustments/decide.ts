import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { id, status, decisionNote = null } = req.body;
    if (!id || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'id and status(approved|rejected) are required' });

    const supabase = getServiceSupabase();
    const { data: adjustment, error: lookupError } = await supabase.from('adjustments').select('station_id').eq('id', id).maybeSingle();
    if (lookupError) return res.status(500).json({ error: lookupError.message });
    if (!adjustment) return res.status(404).json({ error: 'التعديل غير موجود.' });
    const actor = await requireStationManager(req, adjustment.station_id);
    const { data, error } = await supabase.from('adjustments').update({ status: status, decision_note: decisionNote, decided_by: actor.id, decided_at: new Date().toISOString() }).eq('id', id).select().limit(1);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ adjustment: data?.[0] ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
