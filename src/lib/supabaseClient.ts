import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

  const authMock = {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: (_callback: any) => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async (_creds: any) => ({ data: null, error: null }),
    resetPasswordForEmail: async (_email: string, _options: unknown) => ({ data: null, error: null }),
    updateUser: async (_attributes: unknown) => ({ data: null, error: null }),
    signOut: async () => ({ error: null }),
  };

  return {
    from: () => chainable(),
    rpc: async () => ({ data: null, error: null }),
    auth: authMock,
  } as any;
}

if (!url || !key) {
  if (typeof window === 'undefined') {
    // server-side environment may use service client instead
  } else {
    console.warn('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY; using mock client');
  }
}

// Persist sessions in localStorage so authentication survives redirects/reloads
const supabase = (url && key) ? createClient(url, key, { auth: { persistSession: true } }) : makeMockClient();

export default supabase;
