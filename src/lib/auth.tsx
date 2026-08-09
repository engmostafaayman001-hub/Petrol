import React, { createContext, useContext, useEffect, useState } from 'react';
import supabase from './supabaseClient';

type AuthContextType = {
  user: any | null;
  session: any | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then((res: any) => {
      const data = res?.data;
      if (!mounted) return;
      setSession(data?.session ?? null);
      setUser(data?.session?.user ?? null);
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, sess: any) => {
      setSession(sess ?? null);
      setUser(sess?.user ?? null);
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
  }

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signIn, signOut }}>
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
