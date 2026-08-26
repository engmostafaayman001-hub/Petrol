import type { NextApiRequest, NextApiResponse } from 'next';
import { getRequestSupabase } from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const stationId = String(req.query.stationId || '');
  if (!stationId) return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
  const supabase = getRequestSupabase(req);
  if (!supabase) return res.status(401).json({ error: 'يجب تسجيل الدخول.' });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return res.status(401).json({ error: 'جلسة تسجيل الدخول غير صالحة.' });
  const [profileResult, shiftsResult, metersResult, tanksResult, sessionsResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('id', authData.user.id).maybeSingle(),
    supabase.from('shifts').select('id, code, name, seq, shift_period').eq('station_id', stationId).eq('is_active', true).order('seq'),
    supabase.from('pump_meters').select('id, code, name, tank_id, meter_slot').eq('station_id', stationId).eq('is_active', true).order('tank_id').order('meter_slot'),
    supabase.from('v_tank_status').select('tank_id, tank_code, tank_name, fuel_type_id, fuel_code, fuel_name, capacity, system_quantity, status, is_active').eq('station_id', stationId).eq('is_active', true).eq('status', 'operational').order('tank_code'),
    supabase.from('reconciliation_sessions').select('id,status,submitted_at').eq('station_id', stationId).in('status', ['submitted', 'approved']).order('submitted_at', { ascending: false }),
  ]);
  const failed = [profileResult, shiftsResult, metersResult, tanksResult, sessionsResult].find((result) => result.error);
  if (failed?.error) return res.status(500).json({ error: failed.error.message });
  const operationalTankIds = new Set((tanksResult.data || []).map((tank: { tank_id: string }) => tank.tank_id));
  const meters = (metersResult.data || []).filter((meter: { tank_id: string }) => operationalTankIds.has(meter.tank_id));
  const meterCountByTank = meters.reduce((counts: Record<string, number>, meter: { tank_id: string }) => {
    counts[meter.tank_id] = (counts[meter.tank_id] || 0) + 1;
    return counts;
  }, {});
  const tanks = (tanksResult.data || []).map((tank: any) => ({
    ...tank,
    meter_readings_count: meterCountByTank[tank.tank_id] || 1,
  }));
  const closedSessionIds = (sessionsResult.data || []).map((session: any) => session.id);
  const { data: previousReadings } = closedSessionIds.length
    ? await supabase.from('reconciliation_meter_readings').select('meter_id,closing_reading,session_id,recorded_at').in('session_id', closedSessionIds).not('closing_reading', 'is', null).order('recorded_at', { ascending: false })
    : { data: [] };
  const previous_openings: Record<string, number> = {};
  for (const reading of previousReadings || []) if (previous_openings[reading.meter_id] === undefined) previous_openings[reading.meter_id] = Number(reading.closing_reading);
  const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {} as Record<string, string>);
  return res.status(200).json({
    user: profileResult.data,
    date: `${cairoDate.year}-${cairoDate.month}-${cairoDate.day}`,
    time: new Date().toISOString(),
    shifts: shiftsResult.data || [],
    meters,
    tanks,
    previous_openings,
  });
}
