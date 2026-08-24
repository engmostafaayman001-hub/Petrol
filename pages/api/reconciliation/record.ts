import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  try {
    const { session_id, meter_id, line_id, opening_meter, meter_reading } = req.body || {};
    if (!uuid.test(String(session_id || ''))) return res.status(400).json({ error: 'معرّف الجلسة غير صالح.' });
    const reading = Number(meter_reading);
    if (!Number.isFinite(reading) || reading < 0) return res.status(400).json({ error: 'قراءة نهاية العداد يجب أن تكون رقماً صحيحاً أو صفراً.' });
    const supabase = getServiceSupabase(); const { data: session, error: sessionError } = await supabase.from('reconciliation_sessions').select('status, station_id').eq('id', session_id).maybeSingle();
    if (sessionError) return res.status(400).json({ error: sessionError.message }); if (!session) return res.status(404).json({ error: 'جلسة التسوية غير موجودة.' }); if (session.status !== 'open') return res.status(409).json({ error: 'هذه الجلسة مغلقة بالفعل. افتح وردية جديدة لتسجيل قراءات جديدة.' });
    try { await requireStationOperator(req, session.station_id); } catch (error: any) { return res.status(401).json({ error: error.message }); }
    let resolvedMeterId = String(meter_id || '');
    if (!uuid.test(resolvedMeterId) && uuid.test(String(line_id || ''))) {
      const { data: line, error: lineError } = await supabase.from('reconciliation_lines').select('id, tank_id, opening_meter').eq('id', line_id).eq('session_id', session_id).maybeSingle();
      if (lineError) return res.status(400).json({ error: lineError.message });
      if (!line) return res.status(404).json({ error: 'سطر التسوية غير موجود.' });
      if (line.opening_meter === null || line.opening_meter === undefined) {
        const opening = Number(opening_meter);
        if (!Number.isFinite(opening) || opening < 0) return res.status(400).json({ error: 'أدخل قراءة الافتتاح مرة واحدة لهذه الجلسة القديمة.' });
        const { data: initializedMeter, error: openingError } = await supabase.rpc('fn_initialize_legacy_meter_reading', { p_session_id: session_id, p_line_id: line.id, p_opening_meter: opening });
        if (openingError) return res.status(400).json({ error: openingError.message });
        resolvedMeterId = initializedMeter;
      }
      if (!uuid.test(resolvedMeterId)) {
        const { data: meter, error: meterError } = await supabase.from('pump_meters').select('id').eq('tank_id', line.tank_id).eq('station_id', session.station_id).eq('is_active', true).maybeSingle();
        if (meterError) return res.status(400).json({ error: meterError.message });
        if (!meter) return res.status(400).json({ error: 'لا يوجد عداد نشط مرتبط بهذا الخزان.' });
        resolvedMeterId = meter.id;
      }
    }
    if (!uuid.test(resolvedMeterId)) return res.status(400).json({ error: 'معرّف العداد غير صالح أو لا توجد قراءة افتتاح محفوظة.' });
    let { data, error } = await supabase.rpc('fn_record_closing_meter', { p_session_id: session_id, p_meter_id: resolvedMeterId, p_meter_reading: reading });
    // Older databases expose the two-argument compatibility RPC. Keep old open sessions usable while migrations propagate.
    if (error?.code === 'PGRST202') {
      ({ data, error } = await supabase.rpc('fn_record_closing_meter', { p_session_id: session_id, p_meter_reading: reading }));
    }
    if (error) return res.status(400).json({ error: error.message, code: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null }); return res.status(200).json({ result: data });
  } catch (error: any) {
    console.error('reconciliation/record error:', error);
    return res.status(500).json({ error: error.message || 'خطأ داخلي أثناء حفظ القراءة.' });
  }
}
