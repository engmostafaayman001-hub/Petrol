import { createClient, SupabaseClient } from '@supabase/supabase-js';

let svc: SupabaseClient | null = null;

function makeMockClient() {
  const chainable = () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      single: async () => ({ data: null, error: null }),
      insert: () => q,
      then: (resolve: any) => resolve({ data: null, error: null }),
    };
    return q;
  };

  return {
    from: () => chainable(),
    rpc: async () => ({ data: null, error: null }),
  } as any as SupabaseClient;
}

export function getServiceSupabase(): SupabaseClient {
  if (svc) return svc;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === 'test' || process.env.CI) {
      svc = makeMockClient();
      return svc;
    }

    throw new Error('Missing Supabase service-role configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the runtime environment.');
  }

  svc = createClient(url, key, {
    auth: { persistSession: false },
  });

  return svc;
}

export default getServiceSupabase;
