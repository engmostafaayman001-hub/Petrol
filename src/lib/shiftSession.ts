import type { SupabaseClient } from '@supabase/supabase-js';

export class OpenShiftRequiredError extends Error {
  constructor() {
    super('لا توجد جلسة مفتوحة لهذا التاريخ. افتح الوردية أولاً أو اختر تاريخ الوردية المفتوحة.');
    this.name = 'OpenShiftRequiredError';
  }
}

export async function resolveOpenShiftSession(
  supabase: SupabaseClient,
  stationId: string,
  businessDate: string,
  requestedShiftId?: string,
): Promise<{ sessionId: string; shiftId: string; businessDate: string }> {
  let query = supabase.from('reconciliation_sessions')
    .select('id,shift_id,business_date')
    .eq('station_id', stationId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1);
  if (requestedShiftId) query = query.eq('shift_id', requestedShiftId);
  else query = query.eq('business_date', businessDate);
  let { data: openSession, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);

  // A night shift can remain open after the device calendar changes.
  if (!openSession && !requestedShiftId) {
    const fallback = await supabase.from('reconciliation_sessions')
      .select('id,shift_id,business_date')
      .eq('station_id', stationId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    openSession = fallback.data;
    error = fallback.error;
    if (error) throw new Error(error.message);
  }
  if (!openSession?.shift_id || !openSession.business_date) throw new OpenShiftRequiredError();
  return { sessionId: openSession.id, shiftId: openSession.shift_id, businessDate: openSession.business_date };
}

/** Ensures every operational movement belongs to an already-open shift. */
export async function ensureOpenShiftSession(
  supabase: SupabaseClient,
  stationId: string,
  businessDate: string,
  requestedShiftId?: string,
): Promise<string> {
  return (await resolveOpenShiftSession(supabase, stationId, businessDate, requestedShiftId)).shiftId;
}
