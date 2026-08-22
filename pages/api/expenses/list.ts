import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  try {
    const stationId = String(req.query.stationId || '').trim();
    if (!stationId) return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
    await requireStationOperator(req, stationId);
    const { data, error } = await getServiceSupabase()
      .from('expenses')
      .select('id,station_id,session_id,shift_id,business_date,category,description,amount,status,created_by,created_at,decided_by,decided_at,decision_note')
      .eq('station_id', stationId)
      .order('business_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) return res.status(500).json({ error: error.message });
    const expenses = data || [];
    const shiftIds = [...new Set(expenses.map((expense) => expense.shift_id).filter(Boolean))];
    const creatorIds = [...new Set(expenses.map((expense) => expense.created_by).filter(Boolean))];
    const [{ data: shifts, error: shiftsError }, { data: profiles, error: profilesError }] = await Promise.all([
      shiftIds.length ? getServiceSupabase().from('shifts').select('id,name,code').in('id', shiftIds) : Promise.resolve({ data: [], error: null }),
      creatorIds.length ? getServiceSupabase().from('profiles').select('id,full_name').in('id', creatorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (shiftsError || profilesError) return res.status(500).json({ error: shiftsError?.message || profilesError?.message });
    const shiftById = new Map((shifts || []).map((shift) => [shift.id, shift]));
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    return res.status(200).json({ expenses: expenses.map((expense) => ({
      ...expense,
      shift_name: shiftById.get(expense.shift_id)?.name || null,
      shift_code: shiftById.get(expense.shift_id)?.code || null,
      created_by_name: profileById.get(expense.created_by)?.full_name || null,
    })) });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'تعذر تحميل المصروفات.' });
  }
}
