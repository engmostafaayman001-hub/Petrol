import type { NextApiRequest, NextApiResponse } from 'next';
import getServiceSupabase from '../../../src/lib/supabaseServer';
import { requireStationOperator } from '../../../src/lib/reconciliationAuth';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const FIXED_SELLER = {
  name: 'التعاون للبترول / هالة محمود عبدالعزيز بدران',
  taxNumber: '325583927',
  commercialRegistrationNumber: '7893',
  registrationNumber: '325583927',
  email: 'halamohamoud3@gmail.com',
  phone: '01146110222',
  address: 'شارع الابراهيمية مركز الفشن بني سويف',
} as const;
type InvoiceItem = { item_code: string | null; item_name: string; item_category_code: string | null; item_description: string | null; item_unit: string; item_quantity: number; item_unit_price: number; item_discount: number; subtotal: number; net_amount: number };

function invoiceNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `EX-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const stationId = text(req.query.stationId || req.body?.station_id);
  if (!uuid.test(stationId)) return res.status(400).json({ error: 'معرف المحطة غير صالح.' });

  try {
    const operator = await requireStationOperator(req, stationId);
    const db = getServiceSupabase();

    if (req.method === 'GET') {
      const { data, error } = await db.from('extra_sales')
        .select('*')
        .eq('station_id', stationId)
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ sales: data || [] });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة.' });
    const body = req.body || {};
    const sellerStationName = FIXED_SELLER.name;
    const submittedItems = Array.isArray(body.items) ? body.items : [body];
    const items: InvoiceItem[] = submittedItems.map((raw: any) => {
      const itemName = text(raw.item_name);
      const quantity = Number(raw.item_quantity);
      const unitPrice = Number(raw.item_unit_price);
      const discount = Number(raw.item_discount || 0);
      const itemSubtotal = quantity * unitPrice;
      return { item_code: text(raw.item_code) || null, item_name: itemName, item_category_code: text(raw.item_category_code) || null, item_description: text(raw.item_description) || null, item_unit: text(raw.item_unit) || 'قطعة', item_quantity: quantity, item_unit_price: unitPrice, item_discount: discount, subtotal: itemSubtotal, net_amount: itemSubtotal - discount };
    });
    if (!sellerStationName || !items.length || items.some((entry) => !entry.item_name || !Number.isFinite(entry.item_quantity) || entry.item_quantity <= 0 || !Number.isFinite(entry.item_unit_price) || entry.item_unit_price < 0 || !Number.isFinite(entry.item_discount) || entry.item_discount < 0 || entry.item_discount > entry.subtotal)) {
      return res.status(400).json({ error: 'أكمل بيانات الأصناف وتحقق من الكمية والسعر والخصم.' });
    }
    const subtotal = items.reduce((total, entry) => total + entry.subtotal, 0);
    const discount = items.reduce((total, entry) => total + entry.item_discount, 0);
    const netAmount = items.reduce((total, entry) => total + entry.net_amount, 0);
    const firstItem = items[0]!;

    const { data, error } = await db.from('extra_sales').insert({
      station_id: stationId,
      invoice_number: invoiceNumber(),
      station_owner_name: sellerStationName,
      tax_number: FIXED_SELLER.taxNumber,
      commercial_registration_number: FIXED_SELLER.commercialRegistrationNumber,
      registration_number: FIXED_SELLER.registrationNumber,
      email: FIXED_SELLER.email,
      phone: FIXED_SELLER.phone,
      sale_description: firstItem.item_description || items.map((entry) => entry.item_name).join('، '),
      amount: netAmount,
      seller_station_name: sellerStationName,
      seller_tax_number: FIXED_SELLER.taxNumber,
      seller_commercial_registration_number: FIXED_SELLER.commercialRegistrationNumber,
      seller_registration_number: FIXED_SELLER.registrationNumber,
      seller_email: FIXED_SELLER.email,
      seller_phone: FIXED_SELLER.phone,
      seller_address: FIXED_SELLER.address,
      buyer_name: text(body.buyer_name) || null,
      buyer_tax_number: text(body.buyer_tax_number) || null,
      buyer_registration_number: text(body.buyer_registration_number) || null,
      buyer_address: text(body.buyer_address) || null,
      item_code: firstItem.item_code,
      item_name: firstItem.item_name,
      item_category_code: firstItem.item_category_code,
      item_description: firstItem.item_description,
      item_unit: firstItem.item_unit,
      item_quantity: firstItem.item_quantity,
      item_unit_price: firstItem.item_unit_price,
      item_discount: discount,
      subtotal,
      net_amount: netAmount,
      items,
      created_by: operator.id,
    }).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ sale: data });
  } catch (error: any) {
    const message = error?.message || 'تعذر تنفيذ العملية.';
    return res.status(/تسجيل الدخول|جلسة|صلاحية|غير صالح/.test(message) ? 403 : 400).json({ error: message });
  }
}
