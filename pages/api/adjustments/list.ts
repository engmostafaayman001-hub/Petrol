import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('adjustments').select('*').order('requested_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ adjustments: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
