import { describe, it, expect } from 'vitest';
import { z } from 'zod';

describe('zod sanity', () => {
  it('parses sale schema', () => {
    const schema = z.object({ station_id: z.string(), tank_id: z.string(), quantity: z.number().positive() });
    const result = schema.safeParse({ station_id: 's1', tank_id: 't1', quantity: 10 });
    expect(result.success).toBe(true);
  });
});
