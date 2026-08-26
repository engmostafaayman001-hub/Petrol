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
      if (!supplierId) {
        const supplierIds = (data || []).map((supplier: any) => supplier.id);
        if (!supplierIds.length) return res.status(200).json({ suppliers: [] });
        const [{ data: deliveries, error: deliveriesError }, { data: payments, error: paymentsError }, { data: fuelTypes, error: fuelTypesError }] = await Promise.all([
          db.from('deliveries').select('supplier_id,fuel_type_id,quantity,unit_cost,paid_amount').eq('station_id', stationId).eq('status', 'active').in('supplier_id', supplierIds),
          db.from('account_transactions').select('supplier_id,debit').eq('station_id', stationId).eq('transaction_type', 'supplier_payment').in('supplier_id', supplierIds),
          db.from('fuel_types').select('id,name,code').eq('station_id', stationId),
        ]);
        if (deliveriesError || paymentsError || fuelTypesError) throw deliveriesError || paymentsError || fuelTypesError;
        const fuelNames = new Map((fuelTypes || []).map((fuel: any) => [fuel.id, fuel.name || fuel.code]));
        const summaries = new Map<string, { supply_count: number; total_supplies: number; total_paid: number; fuel_quantities: Map<string, number> }>();
        for (const delivery of deliveries || []) {
          const summary = summaries.get(delivery.supplier_id) || { supply_count: 0, total_supplies: 0, total_paid: 0, fuel_quantities: new Map<string, number>() };
          summary.supply_count += 1;
          summary.total_supplies += Number(delivery.quantity || 0) * Number(delivery.unit_cost || 0);
          summary.total_paid += Number(delivery.paid_amount || 0);
          const fuelName = fuelNames.get(delivery.fuel_type_id) || 'وقود غير محدد';
          summary.fuel_quantities.set(fuelName, Number(summary.fuel_quantities.get(fuelName) || 0) + Number(delivery.quantity || 0));
          summaries.set(delivery.supplier_id, summary);
        }
        for (const payment of payments || []) {
          const summary = summaries.get(payment.supplier_id) || { supply_count: 0, total_supplies: 0, total_paid: 0, fuel_quantities: new Map<string, number>() };
          summary.total_paid += Number(payment.debit || 0);
          summaries.set(payment.supplier_id, summary);
        }
        return res.status(200).json({ suppliers: (data || []).map((supplier: any) => {
          const summary = summaries.get(supplier.id) || { supply_count: 0, total_supplies: 0, total_paid: 0, fuel_quantities: new Map<string, number>() };
          return { ...supplier, supply_count: summary.supply_count, total_supplies: summary.total_supplies, total_paid: summary.total_paid, total_due: Math.max(summary.total_supplies - summary.total_paid, 0), fuel_breakdown: [...summary.fuel_quantities.entries()].map(([name, quantity]) => ({ name, quantity })) };
        }) });
      }
      const supplier = (data || []).find((item) => item.id === supplierId);
      if (!supplier) return res.status(404).json({ error: 'المورد غير موجود.' });
      const { data: entries, error: entriesError } = await db.from('account_transactions').select('id,transaction_type,debit,credit,amount,business_date,reference_id,created_at,notes').eq('station_id', stationId).eq('supplier_id', supplierId).order('business_date', { ascending: true }).order('created_at', { ascending: true });
      if (entriesError) throw entriesError;
      const { data: deliveries, error: deliveriesError } = await db.from('deliveries').select('id,business_date,quantity,unit_cost,paid_amount,created_at').eq('station_id', stationId).eq('supplier_id', supplierId).eq('status', 'active').order('business_date', { ascending: true }).order('created_at', { ascending: true });
      if (deliveriesError) throw deliveriesError;

      // Older deliveries may predate the account trigger. Include their outstanding
      // amount in the ledger response without duplicating entries posted by the trigger.
      const postedDeliveryIds = new Set((entries || []).filter((entry: any) => entry.transaction_type === 'delivery' && entry.reference_id).map((entry: any) => entry.reference_id));
      const missingDeliveryEntries = (deliveries || []).flatMap((delivery: any) => {
        const due = Math.max(Number(delivery.quantity || 0) * Number(delivery.unit_cost || 0) - Number(delivery.paid_amount || 0), 0);
        return !postedDeliveryIds.has(delivery.id) && due > 0 ? [{
          id: `delivery-${delivery.id}`,
          transaction_type: 'delivery',
          debit: 0,
          credit: due,
          amount: due,
          business_date: delivery.business_date,
          reference_id: delivery.id,
          created_at: delivery.created_at,
          notes: 'توريد آجل',
        }] : [];
      });
      const transactions = [...(entries || []), ...missingDeliveryEntries].sort((left: any, right: any) => `${left.business_date} ${left.created_at || ''}`.localeCompare(`${right.business_date} ${right.created_at || ''}`));
      const totalSupplies = (deliveries || []).reduce((total: number, delivery: any) => total + Number(delivery.quantity || 0) * Number(delivery.unit_cost || 0), 0);
      const paidWithDelivery = (deliveries || []).reduce((total: number, delivery: any) => total + Number(delivery.paid_amount || 0), 0);
      const supplierPayments = (entries || []).filter((entry: any) => entry.transaction_type === 'supplier_payment').reduce((total: number, entry: any) => total + Number(entry.debit || 0), 0);
      const totalPaid = paidWithDelivery + supplierPayments;
      const balance = Math.max(totalSupplies - totalPaid, 0);
      return res.status(200).json({ supplier, transactions, balance, summary: { operations: deliveries?.length || 0, total_supplies: totalSupplies, total_paid: totalPaid, total_due: balance } });
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
