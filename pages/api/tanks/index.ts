import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stationIdRaw = (req.query.stationId as string | undefined)?.trim();
    const stationIdFromBody = (req.body as any)?.stationId?.trim?.();

    if (stationIdRaw && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(stationIdRaw)) {
      return res.status(400).json({ error: 'Invalid stationId' });
    }

    const stationId = stationIdRaw || stationIdFromBody;
    if (!stationId) {
      return res.status(400).json({ error: 'stationId is required' });
    }

    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('v_tank_status')
      .select('*')
      .eq('station_id', stationId)
      .order('tank_code', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tanks: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

