import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager, requireStationOperator } from '../../../src/lib/reconciliationAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const stationId = String(req.query.stationId || req.body?.station_id || '').trim();
  if (!stationId) return res.status(400).json({ error: 'معرف المحطة مطلوب.' });
  try {
    const actor = await requireStationOperator(req, stationId);
    const db = getServiceSupabase();
    if (req.method === 'GET') {
      const supplierId = String(req.query.supplierId || '').trim();
      const { data, error } = await db.from('suppliers').select('id,code,name,contact_name,contact_phone,notes,is_active').eq('station_id', stationId).eq('is_active', true).order('name');
      if (error) throw error;
      if (!supplierId) return res.status(200).json({ suppliers: data || [] });
      const supplier = (data || []).find((item) => item.id === supplierId);
      if (!supplier) return res.status(404).json({ error: 'المورد غير موجود.' });
      const { data: entries, error: entriesError } = await db.from('account_transactions').select('*').eq('station_id', stationId).eq('supplier_id', supplierId).order('business_date', { ascending: true }).order('created_at', { ascending: true });
      if (entriesError) throw entriesError;
      const balance = (entries || []).reduce((total: number, entry: any) => total + Number(entry.credit || 0) - Number(entry.debit || 0), 0);
      return res.status(200).json({ supplier, transactions: entries || [], balance });
    }
    if (req.method === 'POST') {
      await requireStationManager(req, stationId);
      const { name, code, contact_name, contact_phone, notes } = req.body || {};
      if (typeof name !== 'string' || name.trim().length < 2 || typeof code !== 'string' || code.trim().length < 2) return res.status(400).json({ error: 'اسم المورد وكوده مطلوبان.' });
      const { data, error } = await db.from('suppliers').insert({ station_id: stationId, code: code.trim().toUpperCase(), name: name.trim(), contact_name: contact_name?.trim() || null, contact_phone: contact_phone?.trim() || null, notes: notes?.trim() || null }).select('id,code,name,contact_name,contact_phone,notes,is_active').single();
      if (error) return res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'كود المورد مستخدم بالفعل.' : error.message });
      return res.status(201).json({ supplier: data });
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      await requireStationManager(req, stationId);
      const supplierId = String(req.body?.id || req.query.supplierId || '').trim();
      if (!supplierId) return res.status(400).json({ error: 'معرف المورد مطلوب.' });
      const update = {
        name: typeof req.body?.name === 'string' ? req.body.name.trim() : undefined,
        code: typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : undefined,
        contact_name: typeof req.body?.contact_name === 'string' ? req.body.contact_name.trim() || null : null,
        contact_phone: typeof req.body?.contact_phone === 'string' ? req.body.contact_phone.trim() || null : null,
        notes: typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null,
      };
      if (req.method === 'PATCH' && (!update.name || update.name.length < 2 || !update.code || update.code.length < 2)) return res.status(400).json({ error: 'اسم المورد وكوده مطلوبان.' });
      if (req.method === 'DELETE') {
        const { error } = await db.from('suppliers').delete().eq('id', supplierId).eq('station_id', stationId);
        if (error) return res.status(409).json({ error: 'لا يمكن حذف المورد نهائيًا لأنه مرتبط بتوريدات أو مدفوعات تاريخية.' });
        return res.status(200).json({ deleted: true });
      }
      const { data, error } = await db.from('suppliers').update(update).eq('id', supplierId).eq('station_id', stationId).select('id,code,name,contact_name,contact_phone,notes,is_active').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ supplier: data });
    }
    return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  } catch (error: any) {
    const message = error.message || 'تعذر تنفيذ العملية.';
    return res.status(/المدير فقط|صلاحية/i.test(message) ? 403 : /تسجيل الدخول|المحطة|جلسة/i.test(message) ? 401 : 500).json({ error: message });
  }
}
