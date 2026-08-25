import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationManager, requireStationOperator } from '../../../src/lib/reconciliationAuth';
import { parseNumericInput, roundDecimal } from '../../../src/core/numbers';
import { calculateCustomerInternalTransaction } from '../../../src/core/customerInternal';

function errorStatus(message: string) {
  if (/المدير فقط|صلاحية|permission|insufficient/i.test(message)) return 403;
  if (/جلسة|تسجيل الدخول|المحطة/i.test(message)) return 401;
  return 400;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const stationId = String(req.query.stationId || req.body?.station_id || '').trim();
  const customerId = String(req.query.customerId || req.body?.customer_id || '').trim();
  if (!stationId || !customerId) return res.status(400).json({ error: 'المحطة والعميل مطلوبان.' });
  try {
    const db = getServiceSupabase();
    const actor = await requireStationOperator(req, stationId);
    const { data: customer, error: customerError } = await db.from('customers').select('id').eq('id', customerId).eq('station_id', stationId).eq('is_active', true).maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return res.status(404).json({ error: 'العميل غير موجود في هذه المحطة.' });

    if (req.method === 'GET') {
      const { data, error } = await db.from('customer_internal_transactions').select('id,customer_id,transaction_type,description,quantity,unit,unit_price,subtotal,discount,total,paid_amount,remaining,business_date,notes,created_by,created_at,updated_at').eq('station_id', stationId).eq('customer_id', customerId).order('business_date', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ transactions: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const quantity = parseNumericInput(body.quantity ?? 0);
      const unitPrice = parseNumericInput(body.unit_price ?? 0);
      const discount = parseNumericInput(body.discount ?? 0);
      const paidAmount = parseNumericInput(body.paid_amount ?? 0);
      if (!description || quantity === null || quantity < 0 || unitPrice === null || unitPrice < 0 || discount === null || discount < 0 || paidAmount === null || paidAmount < 0) return res.status(400).json({ error: 'أكمل وصف العملية والقيم المالية بشكل صحيح.' });
      const { subtotal, total } = calculateCustomerInternalTransaction(quantity, unitPrice, discount, paidAmount);
      if (discount > subtotal) return res.status(400).json({ error: 'الخصم لا يمكن أن يتجاوز الإجمالي قبل الخصم.' });
      if (paidAmount > total) return res.status(400).json({ error: 'المدفوع لا يمكن أن يتجاوز الإجمالي النهائي.' });
      const { data, error } = await db.from('customer_internal_transactions').insert({ station_id: stationId, customer_id: customerId, transaction_type: typeof body.transaction_type === 'string' ? body.transaction_type.trim() || 'purchase' : 'purchase', description, quantity, unit: typeof body.unit === 'string' ? body.unit.trim() || 'وحدة' : 'وحدة', unit_price: unitPrice, discount, paid_amount: paidAmount, business_date: body.business_date || new Date().toISOString().slice(0, 10), notes: typeof body.notes === 'string' ? body.notes.trim() || null : null, created_by: actor.id }).select('id,customer_id,transaction_type,description,quantity,unit,unit_price,subtotal,discount,total,paid_amount,remaining,business_date,notes,created_by,created_at,updated_at').single();
      if (error) throw error;
      return res.status(201).json({ transaction: data });
    }

    if (req.method === 'PATCH' || req.method === 'DELETE') {
      await requireStationManager(req, stationId);
      const id = String(req.body?.id || req.query.id || '').trim();
      if (!id) return res.status(400).json({ error: 'معرف العملية مطلوب.' });
      if (req.method === 'DELETE') {
        const { error } = await db.from('customer_internal_transactions').delete().eq('id', id).eq('station_id', stationId).eq('customer_id', customerId);
        if (error) throw error;
        return res.status(200).json({ deleted: true });
      }
      const body = req.body || {};
      const quantity = parseNumericInput(body.quantity ?? 0);
      const unitPrice = parseNumericInput(body.unit_price ?? 0);
      const discount = parseNumericInput(body.discount ?? 0);
      const paidAmount = parseNumericInput(body.paid_amount ?? 0);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!description || quantity === null || quantity < 0 || unitPrice === null || unitPrice < 0 || discount === null || discount < 0 || paidAmount === null || paidAmount < 0) return res.status(400).json({ error: 'تحقق من بيانات العملية.' });
      const { subtotal, total } = calculateCustomerInternalTransaction(quantity, unitPrice, discount, paidAmount);
      if (discount > subtotal || paidAmount > total) return res.status(400).json({ error: 'تحقق من الخصم والمدفوع.' });
      const { data, error } = await db.from('customer_internal_transactions').update({ transaction_type: typeof body.transaction_type === 'string' ? body.transaction_type.trim() || 'purchase' : 'purchase', description, quantity, unit: typeof body.unit === 'string' ? body.unit.trim() || 'وحدة' : 'وحدة', unit_price: unitPrice, discount, paid_amount: paidAmount, business_date: body.business_date, notes: typeof body.notes === 'string' ? body.notes.trim() || null : null }).eq('id', id).eq('station_id', stationId).eq('customer_id', customerId).select('id,customer_id,transaction_type,description,quantity,unit,unit_price,subtotal,discount,total,paid_amount,remaining,business_date,notes,created_by,created_at,updated_at').single();
      if (error) throw error;
      return res.status(200).json({ transaction: data });
    }
    return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  } catch (error: any) {
    return res.status(errorStatus(error.message || '')).json({ error: error.message || 'تعذر تنفيذ العملية.' });
  }
}
