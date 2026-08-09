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

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // During build (or tests) environment may not have Supabase keys; return a harmless mock
    // so static page generation doesn't crash. Real runtime requires proper env vars.
    // eslint-disable-next-line no-console
    console.warn('getServiceSupabase: SUPABASE env not set, using mock client for build-time.');
    svc = makeMockClient();
    return svc;
  }

  svc = createClient(url, key, {
    auth: { persistSession: false },
  });

  return svc;
}

export default getServiceSupabase;
