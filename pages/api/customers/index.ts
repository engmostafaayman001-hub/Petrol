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
      const customerId = String(req.query.customerId || '').trim();
      const { data, error } = await db.from('customers').select('id,name,phone,email,address,notes,is_active,created_at').eq('station_id', stationId).eq('is_active', true).order('name');
      if (error) throw error;
      if (!customerId) return res.status(200).json({ customers: data || [] });
      const customer = (data || []).find((item) => item.id === customerId);
      if (!customer) return res.status(404).json({ error: 'العميل غير موجود.' });
      const { data: entries, error: entriesError } = await db.from('account_transactions').select('*').eq('station_id', stationId).eq('customer_id', customerId).order('business_date', { ascending: true }).order('created_at', { ascending: true });
      if (entriesError) throw entriesError;
      const { data: sales, error: salesError } = await db.from('sales').select('id,business_date,gross_amount,paid_amount,created_at,created_by').eq('station_id', stationId).eq('customer_id', customerId).eq('status', 'active').order('business_date', { ascending: true }).order('created_at', { ascending: true });
      if (salesError) throw salesError;
      const postedSaleIds = new Set((entries || []).filter((entry: any) => entry.transaction_type === 'sale' && entry.reference_id).map((entry: any) => entry.reference_id));
      const missingSaleEntries = (sales || []).filter((sale: any) => !postedSaleIds.has(sale.id) && Number(sale.gross_amount || 0) - Number(sale.paid_amount || 0) > 0).map((sale: any) => ({
        id: `sale-${sale.id}`,
        transaction_type: 'sale',
        debit: Math.max(Number(sale.gross_amount || 0) - Number(sale.paid_amount || 0), 0),
        credit: 0,
        amount: Math.max(Number(sale.gross_amount || 0) - Number(sale.paid_amount || 0), 0),
        business_date: sale.business_date,
        reference_id: sale.id,
        created_at: sale.created_at,
        notes: 'مبيعات آجلة',
      }));
      const allEntries = [...(entries || []), ...missingSaleEntries].sort((left: any, right: any) => `${left.business_date} ${left.created_at || ''}`.localeCompare(`${right.business_date} ${right.created_at || ''}`));
      const totalSales = (sales || []).reduce((total: number, sale: any) => total + Number(sale.gross_amount || 0), 0);
      const totalPaidFromSales = (sales || []).reduce((total: number, sale: any) => total + Number(sale.paid_amount || 0), 0);
      const totalCollected = (entries || []).filter((entry: any) => entry.transaction_type === 'customer_payment').reduce((total: number, entry: any) => total + Number(entry.credit || 0), 0);
      const totalDue = Math.max(totalSales - totalPaidFromSales - totalCollected, 0);
      return res.status(200).json({ customer, transactions: allEntries, balance: totalDue, summary: { operations: sales?.length || 0, total_sales: totalSales, total_paid: totalPaidFromSales + totalCollected, total_due: totalDue } });
    }
    if (req.method === 'POST') {
      const actor = await requireStationOperator(req, stationId);
      const { data: profile } = await getServiceSupabase().from('profiles').select('role').eq('id', actor.id).eq('station_id', stationId).maybeSingle();
      if (!profile || !['manager', 'supervisor'].includes(profile.role)) return res.status(403).json({ error: 'إدارة العملاء متاحة للمدير أو المشرف.' });
      const { name, phone, email, address, notes } = req.body || {};
      if (typeof name !== 'string' || name.trim().length < 2) return res.status(400).json({ error: 'اسم العميل مطلوب.' });
      const { data, error } = await db.from('customers').insert({ station_id: stationId, name: name.trim(), phone: typeof phone === 'string' ? phone.trim() : null, email: typeof email === 'string' ? email.trim() : null, address: typeof address === 'string' ? address.trim() : null, notes: typeof notes === 'string' ? notes.trim() : null, created_by: actor.id }).select('id,name,phone,email,address,notes,is_active,created_at').single();
      if (error) return res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'هذا العميل موجود بالفعل.' : error.message });
      return res.status(201).json({ customer: data });
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      const actor = await requireStationOperator(req, stationId);
      const { data: profile } = await getServiceSupabase().from('profiles').select('role').eq('id', actor.id).eq('station_id', stationId).maybeSingle();
      if (!profile || !['manager', 'supervisor'].includes(profile.role)) return res.status(403).json({ error: 'تعديل العملاء متاح للمدير أو المشرف.' });
      const customerId = String(req.body?.id || req.query.customerId || '').trim();
      if (!customerId) return res.status(400).json({ error: 'معرف العميل مطلوب.' });
      const update = {
        name: typeof req.body?.name === 'string' ? req.body.name.trim() : undefined,
        phone: typeof req.body?.phone === 'string' ? req.body.phone.trim() || null : null,
        email: typeof req.body?.email === 'string' ? req.body.email.trim() || null : null,
        address: typeof req.body?.address === 'string' ? req.body.address.trim() || null : null,
        notes: typeof req.body?.notes === 'string' ? req.body.notes.trim() || null : null,
      };
      if (req.method === 'PATCH' && (!update.name || update.name.length < 2)) return res.status(400).json({ error: 'اسم العميل مطلوب.' });
      if (req.method === 'DELETE') {
        if (profile.role !== 'manager') return res.status(403).json({ error: 'حذف العميل متاح للمدير فقط.' });
        const { error } = await db.from('customers').delete().eq('id', customerId).eq('station_id', stationId);
        if (error) return res.status(409).json({ error: 'لا يمكن حذف العميل نهائيًا لأنه مرتبط بمبيعات أو تحصيلات تاريخية.' });
        return res.status(200).json({ deleted: true });
      }
      const { data, error } = await db.from('customers').update(update).eq('id', customerId).eq('station_id', stationId).select('id,name,phone,email,address,notes,is_active,created_at').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ customer: data });
    }
    return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  } catch (error: any) {
    const message = error.message || 'تعذر تنفيذ العملية.';
    const status = /المدير فقط|صلاحية/i.test(message) ? 403 : /جلسة|تسجيل الدخول|المحطة/i.test(message) ? 401 : 500;
    return res.status(status).json({ error: message });
  }
}
