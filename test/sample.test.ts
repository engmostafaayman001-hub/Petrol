import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { aggregateCollectedAndProfit, sumTankStock } from '../src/core/inventory/engine';

describe('zod sanity', () => {
  it('parses sale schema', () => {
    const schema = z.object({ station_id: z.string(), tank_id: z.string(), quantity: z.number().positive() });
    const result = schema.safeParse({ station_id: 's1', tank_id: 't1', quantity: 10 });
    expect(result.success).toBe(true);
  });
});

describe('dashboard aggregation', () => {
  it('totals current stock from active tank values', () => {
    const tanks = [
      { system_quantity: 420.5, current_qty: 420.5 },
      { system_quantity: 180, current_qty: 180 },
      { available_quantity: 100 },
    ];
    expect(sumTankStock(tanks)).toBe(700.5);
  });

  it('computes collected and profit from sales and delivery costs', () => {
    const sales = [
      { gross_amount: 1200, quantity: 100, unit_price: 12 },
      { gross_amount: 850, quantity: 50, unit_price: 17 },
    ];
    const deliveries = [
      { quantity: 100, unit_cost: 7.5 },
      { quantity: 80, unit_cost: 8 },
    ];

    const result = aggregateCollectedAndProfit(sales, deliveries);

    expect(result.collected).toBe(2050);
    expect(result.cost).toBe(1390);
    expect(result.profit).toBe(660);
  });
});
