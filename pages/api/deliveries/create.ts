import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { OpenShiftRequiredError, resolveOpenShiftSession } from '../../../src/lib/shiftSession';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';
import { multiplyMoney, parseNumericInput } from '../../../src/core/numbers';

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

    if (!payload?.station_id || !payload?.business_date) {
      return res.status(400).json({ error: 'station_id and business_date are required.' });
    }
    const actor = await requireStationOperator(req, payload.station_id);
    const quantity = parseNumericInput(payload.quantity) ?? NaN;
    const unitCost = parseNumericInput(payload.unit_cost || 0) ?? NaN;
    const paidAmount = parseNumericInput(payload.paid_amount || 0) ?? NaN;
    if (!payload.supplier_id || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(paidAmount) || paidAmount < 0) {
      return res.status(400).json({ error: 'أكمل المورد والكمية والسعر والمدفوع بقيم صحيحة.' });
    }
    const totalCost = multiplyMoney(quantity, unitCost);
    if (paidAmount > totalCost) return res.status(400).json({ error: 'المدفوع لا يمكن أن يتجاوز إجمالي التوريد.' });
    const { data: supplier } = await supabase.from('suppliers').select('id').eq('id', payload.supplier_id).eq('station_id', payload.station_id).eq('is_active', true).maybeSingle();
    if (!supplier) return res.status(400).json({ error: 'المورد غير موجود في هذه المحطة.' });
    const openSession = await resolveOpenShiftSession(supabase, payload.station_id, payload.business_date, payload?.shift_id);

    const normalizedPayload = {
      ...payload,
      session_id: openSession.sessionId,
      fuel_type_id: fuelTypeId,
      shift_id: openSession.shiftId,
      business_date: openSession.businessDate,
      unit_cost: unitCost,
      paid_amount: paidAmount,
      created_by: actor.id,
    };

    // eslint-disable-next-line no-console
    console.log('deliveries/create payload', JSON.stringify(normalizedPayload));

    let { data, error } = await supabase.from('deliveries').insert(normalizedPayload).select().limit(1);
    if (error?.code === 'PGRST204' && /session_id/i.test(error.message)) {
      const { session_id: _sessionId, ...legacyPayload } = normalizedPayload;
      ({ data, error } = await supabase.from('deliveries').insert(legacyPayload).select().limit(1));
    }
    if (error) {
      // eslint-disable-next-line no-console
      console.error('deliveries/create error', error);
      return res.status(400).json({ error: error.message });
    }
    const delivery = data?.[0] ?? null;
    const normalizedTotal = Math.round((quantity * unitCost + Number.EPSILON) * 100) / 100;
    return res.status(201).json({ delivery: delivery ? { ...delivery, total_cost: normalizedTotal, paid_amount: paidAmount, remaining: Math.max(normalizedTotal - paidAmount, 0) } : null });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('deliveries/create exception', err);
    return res.status(err instanceof OpenShiftRequiredError ? 409 : 500).json({ error: err.message });
  }
}
