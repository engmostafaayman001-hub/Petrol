import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

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

    let shiftId = payload?.shift_id;
    if (!shiftId && payload?.station_id) {
      const { data: shift, error: shiftError } = await supabase.from('shifts').select('id').eq('station_id', payload.station_id).order('seq', { ascending: true }).limit(1).single();
      if (!shiftError && shift?.id) {
        shiftId = shift.id;
      } else {
        const { data: createdShift, error: createShiftError } = await supabase.from('shifts').insert({
          station_id: payload.station_id,
          code: 'SHIFT1',
          name: 'Shift 1',
          starts_at: '00:00:00',
          ends_at: '23:59:59',
          seq: 1,
          is_active: true,
        }).select('id').single();
        if (!createShiftError && createdShift?.id) {
          shiftId = createdShift.id;
        }
      }
    }

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
    return res.status(500).json({ error: err.message });
  }
}
