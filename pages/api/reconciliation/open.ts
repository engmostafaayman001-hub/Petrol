import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { station_id, business_date, shift_id } = req.body ?? {};
    if (!station_id || !business_date) {
      return res.status(400).json({ error: 'station_id and business_date required' });
    }

    const supabase = getServiceSupabase();
    let resolvedShiftId = shift_id;

    if (!resolvedShiftId) {
      const { data: shift, error: shiftError } = await supabase
        .from('shifts')
        .select('id')
        .eq('station_id', station_id)
        .eq('is_active', true)
        .order('seq', { ascending: true })
        .limit(1)
        .single();

      if (shiftError || !shift?.id) {
        return res.status(400).json({ error: 'No active shift exists for this station.' });
      }

      resolvedShiftId = shift.id;
    }

    const { data, error } = await supabase.rpc('fn_open_reconciliation', {
      p_station_id: station_id,
      p_business_date: business_date,
      p_shift_id: resolvedShiftId,
    });

    if (error) {
      return res.status(400).json({ error: error.message, details: error.details ?? null, hint: error.hint ?? null });
    }

    return res.status(200).json({ result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
