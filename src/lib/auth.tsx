import React, { createContext, useContext, useEffect, useState } from 'react';
import supabase from './supabaseClient';

type AuthContextType = {
  user: any | null;
  session: any | null;
  role: 'manager' | 'supervisor' | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [role, setRole] = useState<'manager' | 'supervisor' | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async (res: any) => {
      const data = res?.data;
      if (!mounted) return;
      setSession(data?.session ?? null);
      setUser(data?.session?.user ?? null);
      if (data?.session?.user?.id) {
        const profile = await supabase.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
        setRole(profile.data?.role === 'manager' || profile.data?.role === 'supervisor' ? profile.data.role : null);
      }
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, sess: any) => {
      setSession(sess ?? null);
      setUser(sess?.user ?? null);
      if (sess?.user?.id) {
        supabase.from('profiles').select('role').eq('id', sess.user.id).maybeSingle().then(({ data }: { data: { role?: string } | null }) => {
          setRole(data?.role === 'manager' || data?.role === 'supervisor' ? data.role : null);
        });
      } else {
        setRole(null);
      }
      setIsLoading(false);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  async function signIn(email: string, password: string) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, role, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequireAuth(redirect = '/signin') {
  const { user, isLoading } = useAuth();
  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoading && !user) {
      window.location.href = redirect;
    }
  }, [isLoading, user, redirect]);
  return { user, isLoading };
}

export function useRole() {
  const { role, isLoading } = useAuth();
  return { role, isLoading };
}
