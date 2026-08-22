import type { SupabaseClient } from '@supabase/supabase-js';

export class OpenShiftRequiredError extends Error {
  constructor() {
    super('لا توجد جلسة مفتوحة لهذا التاريخ. افتح الوردية أولاً أو اختر تاريخ الوردية المفتوحة.');
    this.name = 'OpenShiftRequiredError';
  }
}

/** Ensures every operational movement belongs to an already-open shift. */
export async function ensureOpenShiftSession(
  supabase: SupabaseClient,
  stationId: string,
  businessDate: string,
  requestedShiftId?: string,
): Promise<string> {
  let shiftId = requestedShiftId;
  if (!shiftId) {
    // Operational forms should always attach to the currently open shift.
    // Picking the first configured shift here broke evening deliveries/sales
    // by looking for a morning session that was already closed.
    const { data: openSession, error } = await supabase.from('reconciliation_sessions').select('id, shift_id')
      .eq('station_id', stationId).eq('business_date', businessDate).eq('status', 'open').maybeSingle();
    if (error) throw new Error(error.message);
    if (!openSession?.shift_id) throw new OpenShiftRequiredError();
    shiftId = openSession.shift_id;
  }
  const { data: session, error } = await supabase.from('reconciliation_sessions')
    .select('id')
    .eq('station_id', stationId)
    .eq('business_date', businessDate)
    .eq('shift_id', shiftId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session?.id) throw new OpenShiftRequiredError();
  return shiftId!;
}
