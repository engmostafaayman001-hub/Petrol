import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';

type ProfileInput = { id?: string; email?: string; full_name?: string; password?: string; role?: 'manager' | 'supervisor'; is_active?: boolean };

async function managerFromRequest(req: NextApiRequest) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const supabase = getServiceSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth.user) return null;
  const { data: profile } = await supabase.from('profiles').select('id,station_id,role,is_active,email').eq('id', auth.user.id).single();
  if (!profile || !profile.is_active || profile.role !== 'manager') return null;
  return profile as { id: string; station_id: string; email: string };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const manager = await managerFromRequest(req);
  if (!manager) return res.status(403).json({ error: 'هذه العملية متاحة لمدير المحطة فقط.' });
  const supabase = getServiceSupabase();
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('profiles').select('id,full_name,email,role,is_active,last_seen_at,created_at').eq('station_id', manager.station_id).order('full_name');
      if (error) throw error;
      return res.status(200).json({ users: data || [] });
    }
    const input = (req.body || {}) as ProfileInput;
    if (req.method === 'POST') {
      if (!input.email || !input.full_name || !input.password || !input.role) return res.status(400).json({ error: 'أكمل الاسم والبريد وكلمة المرور والدور.' });
      const { data: created, error: createError } = await supabase.auth.admin.createUser({ email: input.email.trim().toLowerCase(), password: input.password, email_confirm: true });
      if (createError || !created.user) return res.status(400).json({ error: createError?.message || 'تعذر إنشاء الحساب.' });
      const { error: profileError } = await supabase.from('profiles').insert({ id: created.user.id, station_id: manager.station_id, full_name: input.full_name.trim(), email: input.email.trim().toLowerCase(), role: input.role, is_active: input.is_active !== false, created_by: manager.id });
      if (profileError) { await supabase.auth.admin.deleteUser(created.user.id); throw profileError; }
      return res.status(201).json({ id: created.user.id });
    }
    if (req.method === 'PATCH') {
      if (!input.id) return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
      const { data: target } = await supabase.from('profiles').select('id,email,role').eq('id', input.id).eq('station_id', manager.station_id).single();
      if (!target) return res.status(404).json({ error: 'المستخدم غير موجود.' });
      if (target.email.toLowerCase() === 'markode@gmail.com' && (input.role === 'supervisor' || input.is_active === false)) return res.status(400).json({ error: 'لا يمكن تخفيض صلاحية أو إيقاف مدير النظام.' });
      const updates: Record<string, unknown> = {}; if (input.full_name) updates.full_name = input.full_name.trim(); if (input.role) updates.role = input.role; if (typeof input.is_active === 'boolean') updates.is_active = input.is_active;
      if (input.password) { const { error } = await supabase.auth.admin.updateUserById(input.id, { password: input.password }); if (error) throw error; }
      if (typeof input.is_active === 'boolean') { const { error } = await supabase.auth.admin.updateUserById(input.id, { ban_duration: input.is_active ? 'none' : '876000h' }); if (error) throw error; }
      const { error } = await supabase.from('profiles').update(updates).eq('id', input.id).eq('station_id', manager.station_id); if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      if (!input.id) return res.status(400).json({ error: 'معرف المستخدم مطلوب.' });
      if (input.id === manager.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي.' });
      const { data: target } = await supabase.from('profiles').select('email,role').eq('id', input.id).eq('station_id', manager.station_id).single();
      if (!target) return res.status(404).json({ error: 'المستخدم غير موجود.' });
      if (target.email.toLowerCase() === 'markode@gmail.com') return res.status(400).json({ error: 'لا يمكن حذف مدير النظام.' });
      const { error: profileUpdateError } = await supabase.from('profiles').update({ is_active: false }).eq('id', input.id).eq('station_id', manager.station_id);
      if (profileUpdateError) throw profileUpdateError;
      const { error: banError } = await supabase.auth.admin.updateUserById(input.id, { ban_duration: '876000h' });
      if (banError) throw banError;
      return res.status(200).json({ ok: true, deleted: false, deactivated: true });
    }
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE'); return res.status(405).end();
  } catch (error: any) { return res.status(500).json({ error: error?.message || 'تعذر تنفيذ العملية.' }); }
}
