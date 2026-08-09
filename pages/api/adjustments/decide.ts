import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { id, status, decisionNote = null } = req.body;
    if (!id || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'id and status(approved|rejected) are required' });

    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('adjustments').update({ status: status, decision_note: decisionNote }).eq('id', id).select().limit(1);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ adjustment: data?.[0] ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
