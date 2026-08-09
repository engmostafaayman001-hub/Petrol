import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(_req: any, res: any) {
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('v_ledger_feed').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rows: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
