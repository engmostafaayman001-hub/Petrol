import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { station_id, shift_id, opening_meters } = req.body ?? {};
    if (!station_id) {
      return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
    }
    if (!shift_id || !Array.isArray(opening_meters)) {
      return res.status(400).json({ error: 'اختر نوع الوردية وسجل جميع قراءات العدادات.' });
    }

    const operator = await requireStationOperator(req, station_id);
    const supabase = getServiceSupabase();
    const { data: operatorProfile } = await supabase.from('profiles').select('role').eq('id', operator.id).eq('station_id', station_id).maybeSingle();
    const canOpenFullShift = operatorProfile?.role === 'manager' || operatorProfile?.role === 'supervisor';
    const { data: activeMeters, error: metersError } = await supabase
      .from('pump_meters')
      .select('id,tank_id,meter_slot')
      .eq('station_id', station_id)
      .eq('is_active', true)
      .order('tank_id')
      .order('meter_slot');
    if (metersError) return res.status(500).json({ error: metersError.message });
    const { data: operationalTanks, error: tanksError } = await supabase
      .from('tanks')
      .select('id')
      .eq('station_id', station_id)
      .eq('is_active', true)
      .eq('status', 'operational');
    if (tanksError) return res.status(500).json({ error: tanksError.message });
    const operationalTankIds = new Set((operationalTanks || []).map((tank) => tank.id));
    const operationalMeters = (activeMeters || []).filter((meter) => operationalTankIds.has(meter.tank_id));
    if (!operationalMeters.length) return res.status(400).json({ error: 'لا توجد عدادات مرتبطة بخزانات تشغيلية.' });
    const { data: shift, error: shiftError } = await supabase
      .from('shifts')
      .select('id')
      .eq('id', shift_id)
      .eq('station_id', station_id)
      .eq('is_active', true)
      .maybeSingle();
    if (shiftError) return res.status(500).json({ error: shiftError.message });
    if (!shift) return res.status(400).json({ error: 'الوردية المختارة غير صالحة لهذه المحطة. حدّث الصفحة واختر وردية متاحة.' });
    const submittedReadings = new Map((opening_meters as any[]).map((item) => [String(item?.meter_id || ''), Number(item?.reading)]));
    const missingMeters = operationalMeters.filter((meter) => !submittedReadings.has(meter.id) || !Number.isFinite(submittedReadings.get(meter.id)) || (submittedReadings.get(meter.id) as number) < 0);
    if (missingMeters.length) return res.status(400).json({ error: 'يجب إدخال جميع قراءات العداد المطلوبة لكل خزان.' });
    const normalizedMeters = operationalMeters.map((meter) => ({ meter_id: meter.id, reading: submittedReadings.get(meter.id) }));
    if (opening_meters.length !== normalizedMeters.length) return res.status(400).json({ error: 'يجب إرسال قراءة واحدة لكل عداد نشط فقط.' });
    if (!canOpenFullShift) {
      return res.status(403).json({ error: 'ليس لديك صلاحية فتح الوردية.' });
    }
    const { data: activeTanks, error: tanksStatusError } = await supabase
      .from('v_tank_status')
      .select('tank_id,system_quantity')
      .eq('station_id', station_id)
      .eq('is_active', true)
      .eq('status', 'operational');
    if (tanksStatusError) return res.status(500).json({ error: tanksStatusError.message });
    if (!activeTanks?.length) return res.status(400).json({ error: 'لا توجد خزانات تشغيلية لفتح الوردية.' });
    const normalizedTanks = activeTanks.map((tank) => ({
      tank_id: tank.tank_id,
      reading: Number(tank.system_quantity || 0),
    }));
    console.info('reconciliation/open normalized payload:', {
      tanks: normalizedTanks.length,
      meters: normalizedMeters.length,
      metersByTank: operationalMeters.reduce((groups: Record<string, number[]>, meter) => {
        (groups[meter.tank_id] ||= []).push(meter.meter_slot);
        return groups;
      }, {}),
    });

    const { data, error } = await supabase.rpc('fn_open_reconciliation', {
      p_station_id: station_id,
      p_shift_id: shift_id,
      p_opening_meters: normalizedMeters,
      p_opening_tanks: normalizedTanks,
      p_operator_id: operator.id,
    });

    if (error) {
      console.error('fn_open_reconciliation error:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
      const status = error.code === '23505' ? 409 : 400;
      return res.status(status).json({ error: error.message || 'تعذر فتح الجلسة.', details: error.details ?? null, hint: error.hint ?? null });
    }

    return res.status(200).json({ result: data });
  } catch (err: any) {
    console.error('reconciliation/open error:', err);
    return res.status(400).json({ error: err?.message || 'بيانات فتح الجلسة غير صحيحة.' });
  }
}
