import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { ensureOpenShiftSession, OpenShiftRequiredError } from '../../../src/lib/shiftSession';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const payload = req.body;
    const supabase = getServiceSupabase();

    let fuelTypeId = payload?.fuel_type_id;
    if (!fuelTypeId && payload?.tank_id) {
      const { data: tank, error: tankError } = await supabase.from('tanks').select('fuel_type_id').eq('id', payload.tank_id).single();
      if (!tankError && tank?.fuel_type_id) {
        fuelTypeId = tank.fuel_type_id;
      }
    }

    if (!payload?.station_id || !payload?.business_date) {
      return res.status(400).json({ error: 'station_id and business_date are required.' });
    }
    const shiftId = await ensureOpenShiftSession(supabase, payload.station_id, payload.business_date, payload?.shift_id);

    const normalizedPayload = {
      ...payload,
      fuel_type_id: fuelTypeId,
      shift_id: shiftId,
    };

    // eslint-disable-next-line no-console
    console.log('deliveries/create payload', JSON.stringify(normalizedPayload));

    const { data, error } = await supabase.from('deliveries').insert(normalizedPayload).select().limit(1);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('deliveries/create error', error);
      return res.status(400).json({ error: error.message });
    }
    return res.status(201).json({ delivery: data?.[0] ?? null });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('deliveries/create exception', err);
    return res.status(err instanceof OpenShiftRequiredError ? 409 : 500).json({ error: err.message });
  }
}
