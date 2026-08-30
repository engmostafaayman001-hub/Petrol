import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';
import { can } from '../../../src/core/permissions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { session_id, closing_readings, notes } = req.body || {};

    if (!session_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(session_id))) {
      return res.status(400).json({ error: 'معرّف جلسة التسوية غير صالح.' });
    }

    const supabase = getServiceSupabase();

    // Get session details
    const { data: session, error: sessionError } = await supabase
      .from('reconciliation_sessions')
      .select('status, opened_by, station_id')
      .eq('id', session_id)
      .maybeSingle();

    if (sessionError) return res.status(400).json({ error: sessionError.message });
    if (!session) return res.status(404).json({ error: 'جلسة التسوية غير موجودة.' });
    if (session.status !== 'open') return res.status(409).json({ error: 'هذه الجلسة مغلقة بالفعل.' });

    // Verify user is station operator
    let operator;
    try {
      operator = await requireStationOperator(req, session.station_id);
    } catch (error: any) {
      return res.status(401).json({ error: error.message });
    }

    // Check if user has close permission (manager or supervisor with permission)
    const { data: operatorProfile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', operator.id)
      .eq('station_id', session.station_id)
      .maybeSingle();

    if (profileError) {
      return res.status(400).json({ error: profileError.message });
    }

    const hasClosePermission = !!operatorProfile?.role && can(operatorProfile.role as any, 'reconciliation:close');
    if (!hasClosePermission) {
      return res.status(403).json({ error: 'ليس لديك صلاحية إغلاق الوردية.' });
    }

    // Update closing readings if provided
    if (closing_readings && typeof closing_readings === 'object') {
      const { error: updateError } = await supabase
        .from('reconciliation_meter_readings')
        .upsert(
          Object.entries(closing_readings).map(([meterId, reading]: [string, any]) => ({
            session_id,
            meter_id: meterId,
            closing_reading: Number(reading),
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'session_id,meter_id' }
        );

      if (updateError) {
        return res.status(400).json({ error: updateError.message });
      }
    }

    // Call RPC to close reconciliation
    const { data, error } = await supabase.rpc('fn_close_reconciliation', {
      p_session_id: session_id,
      p_operator_id: operator.id,
      p_notes: notes || null,
    });

    if (error) {
      const status = error.code === '23514' ? 422 : 400;
      return res.status(status).json({
        error: error.message,
        code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
      });
    }

    return res.status(200).json({ result: data });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
