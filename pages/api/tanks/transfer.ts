import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

function parseQuantity(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });

  try {
    const payload = req.body || {};
    const stationId = String(payload.station_id || '').trim();
    const sourceTankId = String(payload.source_tank_id || '').trim();
    const destinationTankId = String(payload.destination_tank_id || '').trim();
    const quantity = parseQuantity(payload.quantity);
    const note = typeof payload.note === 'string' ? payload.note.trim() : null;
    const businessDate = String(payload.business_date || new Date().toISOString().slice(0, 10)).trim();
    const requestToken = typeof payload.request_token === 'string' && payload.request_token.trim() ? payload.request_token.trim() : `${sourceTankId}:${destinationTankId}:${quantity ?? '0'}:${Date.now()}`;

    if (!stationId || !sourceTankId || !destinationTankId) {
      console.warn('tank transfer validation failed: missing ids', { stationId, sourceTankId, destinationTankId, quantity });
      return res.status(400).json({ error: 'يجب تحديد المحطة والخزان المصدر والخزان المستهدف.' });
    }

    if (!Number.isFinite(quantity) || quantity! <= 0) {
      console.warn('tank transfer validation failed: invalid quantity', { stationId, sourceTankId, destinationTankId, quantity });
      return res.status(400).json({ error: 'يجب إدخال كمية نقل صحيحة أكبر من صفر.' });
    }

    const actor = await requireStationOperator(req, stationId);
    const supabase = getServiceSupabase();

    const { data: sourceTank, error: sourceError } = await supabase
      .from('tanks')
      .select('id, station_id, fuel_type_id, is_active, status, code, name')
      .eq('id', sourceTankId)
      .eq('station_id', stationId)
      .maybeSingle();

    if (sourceError) throw sourceError;
    if (!sourceTank) return res.status(404).json({ error: 'الخزان المصدر غير موجود.' });

    const { data: destinationTank, error: destinationError } = await supabase
      .from('tanks')
      .select('id, station_id, fuel_type_id, is_active, status, code, name')
      .eq('id', destinationTankId)
      .eq('station_id', stationId)
      .maybeSingle();

    if (destinationError) throw destinationError;
    if (!destinationTank) return res.status(404).json({ error: 'الخزان المستهدف غير موجود.' });

    if (sourceTankId === destinationTankId) {
      console.warn('tank transfer validation failed: same tank', { stationId, sourceTankId, destinationTankId });
      return res.status(400).json({ error: 'لا يمكن النقل من الخزان إلى نفسه. اختر خزانًا آخر.' });
    }

    if (!sourceTank.is_active) {
      console.warn('tank transfer validation failed: source inactive', { stationId, sourceTankId, sourceTank });
      return res.status(400).json({ error: 'لا يمكن استخدام خزان غير نشط في عملية النقل.' });
    }

    if (!destinationTank.is_active) {
      console.warn('tank transfer validation failed: destination inactive', { stationId, destinationTankId, destinationTank });
      return res.status(400).json({ error: 'لا يمكن استخدام خزان غير نشط في عملية النقل.' });
    }

    const { data: sourceBalanceRow } = await supabase
      .from('tank_balances')
      .select('quantity')
      .eq('tank_id', sourceTankId)
      .maybeSingle();

    const sourceBalance = Number(sourceBalanceRow?.quantity ?? 0);
    if (sourceBalance < quantity!) {
      console.warn('tank transfer validation failed: insufficient source balance', { stationId, sourceTankId, quantity, sourceBalance });
      return res.status(400).json({ error: 'الرصيد المتاح في الخزان المصدر غير كافٍ.' });
    }

    const { data, error } = await supabase.rpc('fn_create_tank_transfer', {
      p_station_id: stationId,
      p_source_tank_id: sourceTankId,
      p_destination_tank_id: destinationTankId,
      p_quantity: quantity,
      p_business_date: businessDate,
      p_note: note,
      p_request_token: requestToken,
      p_actor: actor.id,
    });

    if (error) {
      return res.status(400).json({ error: error.message || 'تعذر تنفيذ النقل بين الخزانات.' });
    }

    return res.status(200).json({
      ok: true,
      transfer_id: data,
      message: `تم نقل ${quantity} لتر بنجاح من ${sourceTank.name || sourceTank.code} إلى ${destinationTank.name || destinationTank.code}.`,
    });
  } catch (error: any) {
    const message = error?.message || 'تعذر تنفيذ النقل بين الخزانات.';
    const status = /جلسة|تسجيل الدخول|صلاحية|المحطة/i.test(message) ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
