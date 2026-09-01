import { describe, expect, it } from 'vitest';
import { validateTankTransferInput } from '../src/core/tankTransfer';

describe('validateTankTransferInput', () => {
  it('accepts transfers between any active tanks in the same station', () => {
    const result = validateTankTransferInput({
      sourceTankId: 'source-1',
      destinationTankId: 'dest-1',
      fuelTypeId: 'fuel-1',
      quantity: 2000,
      sourceFuelTypeId: 'fuel-1',
      destinationFuelTypeId: 'fuel-2',
      sourceActive: true,
      destinationActive: true,
      sourceBalance: 10000,
      destinationBalance: 5000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result).toEqual({ ok: true });
    }
  });

  it('accepts transfers between different fuel types when both tanks are active', () => {
    const result = validateTankTransferInput({
      sourceTankId: 'source-1',
      destinationTankId: 'dest-2',
      fuelTypeId: 'fuel-1',
      quantity: 1500,
      sourceFuelTypeId: 'fuel-1',
      destinationFuelTypeId: 'fuel-2',
      sourceActive: true,
      destinationActive: true,
      sourceBalance: 5000,
      destinationBalance: 1000,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts transfers even when fuel type identifiers are missing or differ', () => {
    const result = validateTankTransferInput({
      sourceTankId: 'source-1',
      destinationTankId: 'dest-2',
      fuelTypeId: undefined as unknown as string,
      quantity: 1500,
      sourceFuelTypeId: undefined as unknown as string,
      destinationFuelTypeId: 'fuel-2',
      sourceActive: true,
      destinationActive: true,
      sourceBalance: 5000,
      destinationBalance: 1000,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects same-tank, inactive, and insufficient stock transfer cases', () => {
    const sameTankResult = validateTankTransferInput({
      sourceTankId: 'source-1',
      destinationTankId: 'source-1',
      fuelTypeId: 'fuel-1',
      quantity: 2000,
      sourceFuelTypeId: 'fuel-1',
      destinationFuelTypeId: 'fuel-1',
      sourceActive: true,
      destinationActive: true,
      sourceBalance: 10000,
      destinationBalance: 5000,
    });

    expect(sameTankResult.ok).toBe(false);
    if (!sameTankResult.ok) {
      expect(sameTankResult.error).toContain('خزان');
    }

    const inactiveResult = validateTankTransferInput({
      sourceTankId: 'source-1',
      destinationTankId: 'dest-2',
      fuelTypeId: 'fuel-1',
      quantity: 500,
      sourceFuelTypeId: 'fuel-1',
      destinationFuelTypeId: 'fuel-2',
      sourceActive: false,
      destinationActive: true,
      sourceBalance: 10000,
      destinationBalance: 5000,
    });

    expect(inactiveResult.ok).toBe(false);
    if (!inactiveResult.ok) {
      expect(inactiveResult.error).toContain('غير نشط');
    }

    const stockResult = validateTankTransferInput({
      sourceTankId: 'source-1',
      destinationTankId: 'dest-2',
      fuelTypeId: 'fuel-1',
      quantity: 20000,
      sourceFuelTypeId: 'fuel-1',
      destinationFuelTypeId: 'fuel-1',
      sourceActive: true,
      destinationActive: true,
      sourceBalance: 10000,
      destinationBalance: 5000,
    });

    expect(stockResult.ok).toBe(false);
    if (!stockResult.ok) {
      expect(stockResult.error).toContain('الرصيد المتاح');
    }
  });
});
