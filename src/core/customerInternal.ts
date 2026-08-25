export function calculateCustomerInternalTransaction(quantity: number, unitPrice: number, discount: number, paidAmount: number) {
  const subtotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
  const total = Math.max(Math.round((subtotal - discount + Number.EPSILON) * 100) / 100, 0);
  const remaining = Math.max(Math.round((total - paidAmount + Number.EPSILON) * 100) / 100, 0);
  return { subtotal, total, remaining };
}
