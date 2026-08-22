import type { NextApiRequest, NextApiResponse } from 'next';
import { getRequestSupabase, getServiceSupabase } from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  try {
    const { id, approved, note } = req.body || {};
    if (!id || typeof approved !== 'boolean') return res.status(400).json({ error: 'بيانات قرار المصروف غير مكتملة.' });
    const requestSupabase = getRequestSupabase(req);
    if (!requestSupabase) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
    const { data: auth, error: authError } = await requestSupabase.auth.getUser();
    if (authError || !auth.user) return res.status(401).json({ error: 'جلسة تسجيل الدخول غير صالحة.' });
    const serviceSupabase = getServiceSupabase();
    const { data: expense, error: expenseError } = await serviceSupabase.from('expenses').select('station_id').eq('id', id).maybeSingle();
    if (expenseError) return res.status(500).json({ error: expenseError.message });
    if (!expense) return res.status(404).json({ error: 'المصروف غير موجود.' });
    const { data: profile, error: profileError } = await serviceSupabase.from('profiles').select('role,is_active,station_id').eq('id', auth.user.id).maybeSingle();
    if (profileError) return res.status(500).json({ error: profileError.message });
    if (!profile?.is_active || profile.role !== 'manager' || profile.station_id !== expense.station_id) return res.status(403).json({ error: 'اعتماد المصروفات متاح لمدير المحطة فقط.' });
    const { error } = await serviceSupabase.rpc('fn_decide_expense', { p_expense_id: id, p_approved: approved, p_actor_id: auth.user.id, p_note: typeof note === 'string' ? note : null });
    if (error) return res.status(error.code === '42501' ? 403 : error.code === 'restrict_violation' ? 409 : 400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'تعذر حفظ قرار المصروف.' });
  }
}
