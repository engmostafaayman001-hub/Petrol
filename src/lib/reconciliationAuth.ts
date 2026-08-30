import type { NextApiRequest } from 'next';
import { getRequestSupabase, getServiceSupabase } from './supabaseServer';

/**
 * Authenticate an API request and make sure its user belongs to the station
 * that is about to be read or changed.  Reconciliation mutations use a
 * service client for atomic RPCs, so this check must happen first.
 */
export async function requireStationOperator(req: NextApiRequest, stationId: string) {
  const requestSupabase = getRequestSupabase(req);
  if (!requestSupabase) throw new Error('يجب تسجيل الدخول للمتابعة.');

  const { data: auth, error: authError } = await requestSupabase.auth.getUser();
  if (authError || !auth.user) throw new Error('جلسة تسجيل الدخول غير صالحة.');

  const serviceSupabase = getServiceSupabase();
  const { data: profile, error: profileError } = await serviceSupabase
    .from('profiles')
    .select('id, station_id, is_active')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile?.is_active || profile.station_id !== stationId) {
    throw new Error('ليس لديك صلاحية للوصول إلى ورديات هذه المحطة.');
  }
  return auth.user;
}

export async function requireStationManager(req: NextApiRequest, stationId: string) {
  const user = await requireStationOperator(req, stationId);
  const supabase = getServiceSupabase();
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).eq('station_id', stationId).eq('is_active', true).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== 'manager') throw new Error('هذا الإجراء متاح للمدير فقط.');
  return user;
}

export async function requireStationShiftManager(req: NextApiRequest, stationId: string) {
  const user = await requireStationOperator(req, stationId);
  const supabase = getServiceSupabase();
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).eq('station_id', stationId).eq('is_active', true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile || !['manager', 'supervisor'].includes(profile.role)) {
    throw new Error('هذا الإجراء متاح للمدير أو المشرف فقط.');
  }
  return user;
}
