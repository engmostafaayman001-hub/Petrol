import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { OpenShiftRequiredError, resolveOpenShiftSession } from '../../../src/lib/shiftSession';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const payload = req.body;
    const supabase = getServiceSupabase();

    let fuelTypeId = payload?.fuel_type_id;
    if (!fuelTypeId && payload?.tank_id) {
      const { data: tank, error: tankError } = await supabase
        .from('tanks')
        .select('fuel_type_id')
        .eq('id', payload.tank_id)
        .single();
      if (!tankError && tank?.fuel_type_id) fuelTypeId = tank.fuel_type_id;
    }

    if (!payload?.station_id || !payload?.business_date) {
      return res.status(400).json({ error: 'المحطة وتاريخ البيع مطلوبان.' });
    }
    const actor = await requireStationOperator(req, payload.station_id);
    const quantity = Number(payload.quantity);
    const unitPrice = Number(payload.unit_price);
    const paidAmount = Number(payload.paid_amount || 0);
    const driverName = typeof payload.driver_name === 'string' ? payload.driver_name.trim() : '';
    const vehicleNumber = typeof payload.vehicle_number === 'string' ? payload.vehicle_number.trim() : '';
    if (!payload.tank_id || !fuelTypeId || !payload.customer_id || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(paidAmount) || paidAmount < 0) {
      return res.status(400).json({ error: 'أكمل العميل والخزان والوقود والكمية والسعر والمدفوع بقيم صحيحة.' });
    }
    const { data: tank } = await supabase.from('tanks').select('id').eq('id', payload.tank_id).eq('station_id', payload.station_id).eq('fuel_type_id', fuelTypeId).eq('is_active', true).maybeSingle();
    if (!tank) return res.status(400).json({ error: 'الخزان غير موجود أو غير مرتبط بنوع الوقود المختار.' });
    const { data: customer } = await supabase.from('customers').select('id').eq('id', payload.customer_id).eq('station_id', payload.station_id).eq('is_active', true).maybeSingle();
    if (!customer) return res.status(400).json({ error: 'العميل غير موجود في هذه المحطة.' });
    const total = Math.round(quantity * unitPrice * 100) / 100;
    if (paidAmount > total) return res.status(400).json({ error: 'المدفوع لا يمكن أن يتجاوز إجمالي عملية البيع.' });
    const openSession = await resolveOpenShiftSession(supabase, payload.station_id, payload.business_date, payload?.shift_id);

    const normalizedPayload = {
      ...payload,
      session_id: openSession.sessionId,
      fuel_type_id: fuelTypeId,
      shift_id: openSession.shiftId,
      business_date: openSession.businessDate,
      created_by: actor.id,
      quantity,
      unit_price: unitPrice,
      paid_amount: paidAmount,
      customer_id: payload.customer_id || null,
      driver_name: driverName || null,
      vehicle_number: vehicleNumber || null,
      payment_method: payload.payment_method || null,
    };

    if (!normalizedPayload.shift_id) {
      return res.status(400).json({ error: 'Shift is required for sale records.' });
    }
    if (!normalizedPayload.fuel_type_id) {
      return res.status(400).json({ error: 'Fuel type is required for sale records.' });
    }

    let { data, error } = await supabase.from('sales').insert(normalizedPayload).select().limit(1);
    // Keep sales capture working while an older PostgREST schema cache is
    // waiting for the session_id migration. The shift/date link remains valid.
    if (error?.code === 'PGRST204' && /session_id/i.test(error.message)) {
      const { session_id: _sessionId, ...legacyPayload } = normalizedPayload;
      ({ data, error } = await supabase.from('sales').insert(legacyPayload).select().limit(1));
    }
    if (error) {
      console.error('sales/create database error:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
      return res.status(400).json({ error: error.message, code: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null });
    }
    return res.status(201).json({ sale: data?.[0] ?? null });
  } catch (err: any) {
    console.error('sales/create exception:', err);
    return res.status(err instanceof OpenShiftRequiredError ? 409 : 500).json({ error: err.message || 'تعذر تسجيل عملية البيع.' });
  }
}
