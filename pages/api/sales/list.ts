import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(_req: any, res: any) {
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.from('v_sales').select('*').order('business_date', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sales: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
