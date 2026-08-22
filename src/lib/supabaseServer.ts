import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { NextApiRequest } from 'next';

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

export function getRequestSupabase(req: NextApiRequest): SupabaseClient | null {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export default getServiceSupabase;
