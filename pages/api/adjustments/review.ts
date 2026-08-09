import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id, approved, reviewer_id } = req.body;
    if (!id || typeof approved === 'undefined') return res.status(400).json({ error: 'id and approved required' });
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('adjustments').update({ status: approved ? 'approved' : 'rejected', reviewer_id }).eq('id', id).select().limit(1).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ adjustment: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
