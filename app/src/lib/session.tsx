import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, loadToken, setToken } from './api';

type User = { id: number; name: string; email: string };
type Session = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        if (await loadToken()) setUser((await api<{ user: User }>('/auth/me')).user);
      } catch {
        await setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const finish = async (r: { token: string; user: User }) => { await setToken(r.token); setUser(r.user); };
  const value: Session = {
    user,
    loading,
    signIn: async (email, password) => finish(await api('/auth/login', { body: { email, password } })),
    register: async (name, email, password) => finish(await api('/auth/register', { body: { name, email, password } })),
    signOut: async () => { await setToken(null); setUser(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
