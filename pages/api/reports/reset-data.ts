import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getRequestSupabase, getServiceSupabase } from '../../../src/lib/supabaseServer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });

  try {
    const { station_id, station_code, password } = req.body || {};
    if (!station_id || !station_code || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'أدخل كلمة المرور وكود المحطة للتأكيد.' });
    }

    const requestSupabase = getRequestSupabase(req);
    if (!requestSupabase) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
    const { data: authData, error: authError } = await requestSupabase.auth.getUser();
    if (authError || !authData.user?.email) return res.status(401).json({ error: 'جلسة تسجيل الدخول غير صالحة.' });

    const { data: profile, error: profileError } = await requestSupabase
      .from('profiles')
      .select('id, station_id, role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError) return res.status(400).json({ error: profileError.message });
    if (!profile?.is_active || profile.station_id !== station_id) return res.status(403).json({ error: 'لا تملك صلاحية هذه المحطة.' });
    if (profile.role !== 'manager') return res.status(403).json({ error: 'حذف بيانات التشغيل متاح لمدير المحطة فقط.' });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return res.status(500).json({ error: 'إعدادات التحقق من كلمة المرور غير مكتملة.' });
    const verifier = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: passwordError } = await verifier.auth.signInWithPassword({ email: authData.user.email, password });
    if (passwordError) return res.status(403).json({ error: 'كلمة المرور غير صحيحة.' });

    const { error } = await getServiceSupabase().rpc('fn_reset_operational_data', {
      p_station_id: station_id,
      p_actor_id: authData.user.id,
      p_confirmation: station_code,
    });
    if (error) {
      console.error('fn_reset_operational_data error:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
      const message = error.message || 'تعذر حذف بيانات التشغيل.';
      const status = error.code === '23505' || error.code === '23001' || error.code === 'restrict_violation'
        ? 409
        : error.code === '42501' || error.code === 'insufficient_privilege'
          ? 403
          : error.code === 'P0002' || error.code === 'no_data_found'
            ? 404
            : error.code === '23514' || error.code === 'check_violation'
              ? 422
              : 400;
      return res.status(status).json({ error: message, code: error.code ?? null, details: error.details ?? null, hint: error.hint ?? null });
    }
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'تعذر حذف بيانات التشغيل.' });
  }
}
