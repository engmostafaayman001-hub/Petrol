import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const stationId = (req.query.stationId as string | undefined)?.trim();
    const date = (req.query.date as string) || undefined;
    if (!stationId) return res.status(400).json({ error: 'stationId is required' });
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(stationId)) {
      return res.status(400).json({ error: 'Invalid stationId' });
    }

    const supabase = getServiceSupabase();
    const rpcArgs: any = { p_station_id: stationId };
    if (date) rpcArgs.p_date = date;

    const { data, error } = await supabase.rpc('fn_station_snapshot', rpcArgs);
    if (error) {
      // log full error on server for debugging
      // eslint-disable-next-line no-console
      console.error('fn_station_snapshot RPC error:', error);
      // include useful fields in JSON response during development
      const payload: any = { message: error.message ?? 'rpc error' };
      if (error.details) payload.details = error.details;
      if (error.hint) payload.hint = error.hint;
      // Map common permission message to 403
      if (String(error.message).toLowerCase().includes('access')) {
        // In development, return an empty snapshot with a warning so the
        // frontend can continue to render. In production, surface 403.
        if (process.env.NODE_ENV !== 'production') {
          return res.status(200).json({ snapshot: null, warning: payload });
        }

        return res.status(403).json({ error: payload });
      }

      return res.status(500).json({ error: payload });
    }

    return res.status(200).json({ snapshot: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
