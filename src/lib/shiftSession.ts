import type { SupabaseClient } from '@supabase/supabase-js';

/** Ensures every operational movement belongs to an open shift session. */
export async function ensureOpenShiftSession(
  supabase: SupabaseClient,
  stationId: string,
  businessDate: string,
  requestedShiftId?: string,
): Promise<string> {
  let shiftId = requestedShiftId;
  if (!shiftId) {
    const { data: shift, error } = await supabase.from('shifts').select('id')
      .eq('station_id', stationId).eq('is_active', true).order('seq', { ascending: true }).limit(1).maybeSingle();
    if (error || !shift?.id) throw new Error('No active shift exists for this station.');
    shiftId = shift.id;
  }
  const { error } = await supabase.rpc('fn_open_reconciliation', {
    p_station_id: stationId, p_business_date: businessDate, p_shift_id: shiftId,
  });
  if (error) throw new Error(error.message);
  // Assigned above either from the request or from the active-shift lookup.
  return shiftId!;
}
