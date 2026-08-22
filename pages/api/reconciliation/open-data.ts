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
  const [profileResult, shiftsResult, metersResult, tanksResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('id', authData.user.id).maybeSingle(),
    supabase.from('shifts').select('id, code, name, seq, shift_period').eq('station_id', stationId).eq('is_active', true).order('seq'),
    supabase.from('pump_meters').select('id, code, name, tank_id').eq('station_id', stationId).eq('is_active', true).order('code'),
    supabase.from('v_tank_status').select('tank_id, tank_code, tank_name, fuel_type_id, fuel_code, fuel_name, capacity, status, is_active').eq('station_id', stationId).eq('is_active', true).eq('status', 'operational').order('tank_code'),
  ]);
  const failed = [profileResult, shiftsResult, metersResult, tanksResult].find((result) => result.error);
  if (failed?.error) return res.status(500).json({ error: failed.error.message });
  const operationalTankIds = new Set((tanksResult.data || []).map((tank: { tank_id: string }) => tank.tank_id));
  const meters = (metersResult.data || []).filter((meter: { tank_id: string }) => operationalTankIds.has(meter.tank_id));
  const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {} as Record<string, string>);
  return res.status(200).json({
    user: profileResult.data,
    date: `${cairoDate.year}-${cairoDate.month}-${cairoDate.day}`,
    time: new Date().toISOString(),
    shifts: shiftsResult.data || [],
    meters,
    tanks: tanksResult.data || [],
  });
}
