export type TankTransferInput = {
  sourceTankId: string;
  destinationTankId: string;
  quantity: number;
  sourceActive: boolean;
  destinationActive: boolean;
  sourceBalance: number;
  destinationBalance?: number;
  fuelTypeId?: string;
  sourceFuelTypeId?: string;
  destinationFuelTypeId?: string;
};

export function validateTankTransferInput(input: TankTransferInput): { ok: true } | { ok: false; error: string } {
  if (!input.sourceTankId || !input.destinationTankId) {
    return { ok: false, error: 'يجب اختيار خزان مصدر وخزان مستهدف.' };
  }

  if (input.sourceTankId === input.destinationTankId) {
    return { ok: false, error: 'لا يمكن النقل من الخزان إلى نفسه. اختر خزانًا آخر.' };
  }

  if (!input.sourceActive || !input.destinationActive) {
    return { ok: false, error: 'لا يمكن استخدام خزان غير نشط في عملية النقل.' };
  }

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'أدخل كمية أكبر من صفر.' };
  }

  const sourceBalance = Number(input.sourceBalance);
  if (!Number.isFinite(sourceBalance) || sourceBalance < 0) {
    return { ok: false, error: 'الكمية المطلوبة أكبر من الرصيد المتاح في الخزان المصدر.' };
  }

  if (quantity > sourceBalance) {
    return { ok: false, error: 'الكمية المطلوبة أكبر من الرصيد المتاح في الخزان المصدر.' };
  }

  return { ok: true };
}
