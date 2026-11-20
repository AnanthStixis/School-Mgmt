import { createContext, useContext, useState, type ReactNode } from 'react';
import type { SessionUser } from '@sms/shared';

/**
 * TEMPORARY demo personas (same as the POC) until real authentication is built.
 * Replace with the auth module (OTP for parents, password/SSO for staff).
 */
export const DEMO_USERS: SessionUser[] = [
  { id: 'U-mgr', role: 'manager', name: 'Dr. Rajesh Kumar', title: 'Group Director (Trust)', email: 'director@bnmpschool.in', branchId: null },
  { id: 'U-bm', role: 'manager', name: 'Anitha Krishnan', title: 'Branch Manager – BNM Public School', email: 'anitha@bnmpschool.in', branchId: 'BNMPS' },
  { id: 'U-tch', role: 'teacher', name: 'Priya Sharma', title: 'Mathematics • Class Teacher 8-A', email: 'priya.sharma@bnmpschool.in', branchId: 'BNMPS' },
  { id: 'U-acc', role: 'accounts', name: 'Kavitha Raman', title: 'Accounts Officer – BNM Public School', email: 'kavitha@bnmpschool.in', branchId: 'BNMPS' },
  { id: 'U-par', role: 'parent', name: 'Suresh Menon', title: 'Parent of Aarav (8-A) & Diya (6-B)', email: 'suresh.menon@mail.com', branchId: 'BNMPS' },
  { id: 'U-stu', role: 'student', name: 'Aarav Menon', title: 'Class 8-A • Roll 1', email: 'aarav.menon@students.bnmpschool.in', branchId: 'BNMPS' },
  { id: 'U-admin', role: 'admin', name: 'Meera Nair', title: 'Platform Super Admin', email: 'meera@stixis.io', branchId: null },
];

const KEY = 'sms_session_user';

interface Session {
  user: SessionUser | null;
  signIn: (id: string) => void;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

function load(): SessionUser | null {
  try {
    const id = localStorage.getItem(KEY);
    return DEMO_USERS.find((u) => u.id === id) ?? null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(load);
  const signIn = (id: string) => {
    const u = DEMO_USERS.find((x) => x.id === id) ?? null;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* storage unavailable */
    }
    setUser(u);
  };
  const signOut = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
    setUser(null);
  };
  return <Ctx.Provider value={{ user, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
