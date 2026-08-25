import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';
import { resolveOpenShiftSession } from '../../../src/lib/shiftSession';
import { parseNumericInput } from '../../../src/core/numbers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
  const { station_id, account_type, customer_id, supplier_id, amount, business_date, payment_method, notes } = req.body || {};
  const value = parseNumericInput(amount) ?? NaN;
  if (!station_id || !['customer', 'supplier'].includes(account_type) || (!customer_id && !supplier_id) || (customer_id && supplier_id) || !Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'أكمل الحساب والمبلغ الصحيح.' });
  try {
    const actor = await requireStationOperator(req, station_id);
    const db = getServiceSupabase();
    const { data: profile } = await db.from('profiles').select('role').eq('id', actor.id).eq('station_id', station_id).eq('is_active', true).maybeSingle();
    if (!profile || profile.role !== 'manager') return res.status(403).json({ error: 'تسجيل التحصيل والدفعات متاح للمشرف فقط.' });
    const isCustomer = account_type === 'customer';
    const accountId = isCustomer ? customer_id : supplier_id;
    const accountTable = isCustomer ? 'customers' : 'suppliers';
    const { data: account } = await db.from(accountTable).select('id').eq('id', accountId).eq('station_id', station_id).eq('is_active', true).maybeSingle();
    if (!account) return res.status(404).json({ error: 'الحساب غير موجود في هذه المحطة.' });
    const { data: entries } = await db.from('account_transactions').select('debit,credit,transaction_type').eq('station_id', station_id).eq(isCustomer ? 'customer_id' : 'supplier_id', accountId);
    let balance = (entries || []).reduce((total: number, entry: any) => isCustomer ? total + Number(entry.debit) - Number(entry.credit) : total + Number(entry.credit) - Number(entry.debit), 0);
    if (isCustomer) {
      const { data: sales, error: salesError } = await db.from('sales').select('gross_amount,paid_amount').eq('station_id', station_id).eq('customer_id', accountId).eq('status', 'active');
      if (salesError) throw salesError;
      const totalSales = (sales || []).reduce((total: number, sale: any) => total + Number(sale.gross_amount || 0), 0);
      const totalPaidFromSales = (sales || []).reduce((total: number, sale: any) => total + Number(sale.paid_amount || 0), 0);
      const totalCollected = (entries || []).filter((entry: any) => entry.transaction_type === 'customer_payment').reduce((total: number, entry: any) => total + Number(entry.credit || 0), 0);
      balance = Math.max(totalSales - totalPaidFromSales - totalCollected, 0);
    }
    if (value > balance) return res.status(409).json({ error: 'المبلغ أكبر من الرصيد المستحق.' });
    const paymentDate = business_date || new Date().toISOString().slice(0, 10);
    let openSession;
    try {
      openSession = await resolveOpenShiftSession(db, station_id, paymentDate);
    } catch (error: any) {
      return res.status(409).json({ error: error.message || 'افتح الوردية أولاً لتسجيل التحصيل.' });
    }
    const { data, error } = await db.from('account_transactions').insert({ station_id, account_type, customer_id: isCustomer ? customer_id : null, supplier_id: isCustomer ? null : supplier_id, transaction_type: isCustomer ? 'customer_payment' : 'supplier_payment', debit: isCustomer ? 0 : value, credit: isCustomer ? value : 0, business_date: openSession.businessDate, session_id: openSession.sessionId, payment_method: payment_method || null, notes: notes || null, created_by: actor.id }).select('id').single();
    if (error) throw error;
    return res.status(201).json({ payment_id: data.id, balance: balance - value });
  } catch (error: any) { return res.status(400).json({ error: error.message || 'تعذر تسجيل الدفعة.' }); }
}
