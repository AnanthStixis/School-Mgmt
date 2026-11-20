import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@sms/shared';
import { api, refreshSession, setSession, setSessionListener } from './api';

type Status = 'loading' | 'signed-in' | 'signed-out';

interface Auth {
  status: Status;
  user: SessionUser | null;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    setSessionListener((s) => {
      setUser(s?.user ?? null);
      setStatus(s ? 'signed-in' : 'signed-out');
    });
    // Restore the session from the refresh cookie on page load.
    void refreshSession();
  }, []);

  const value: Auth = {
    status,
    user,
    loginWithPassword: async (email, password) => setSession(await api.login(email, password)),
    requestOtp: async (phone) => {
      await api.requestOtp(phone);
    },
    verifyOtp: async (phone, code) => setSession(await api.verifyOtp(phone, code)),
    logout: async () => {
      try {
        await api.logout();
      } finally {
        setSession(null);
        qc.clear();
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error('useAuth must be used inside AuthProvider');
  return a;
}
