import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BranchDto } from '@sms/shared';
import { api } from './api';
import { useAuth } from './auth';

/**
 * Which branch the screens show. Branch-bound users are fixed to their own branch;
 * tenant-wide users (School Admin) pick one, or "all" for lists.
 */
interface Scope {
  branches: BranchDto[];
  /** '' = all branches (only for tenant-wide users) */
  branchId: string;
  setBranchId: (id: string) => void;
  isTenantWide: boolean;
  isSchoolAdmin: boolean;
  isManager: boolean;
  branchName: (id: string) => string;
}

const Ctx = createContext<Scope | null>(null);
const KEY = 'sms_branch';

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isTenantWide = !!user?.tenantId && user.branchId === null;
  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches, enabled: !!user?.tenantId });
  const [selected, setSelected] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) ?? '';
    } catch {
      return '';
    }
  });

  // Drop a remembered branch that no longer exists or isn't visible.
  useEffect(() => {
    if (branches.data && selected && !branches.data.some((b) => b.id === selected)) setSelected('');
  }, [branches.data, selected]);

  const branchId = user?.branchId ?? (isTenantWide ? selected : '');
  const value: Scope = {
    branches: branches.data ?? [],
    branchId,
    setBranchId: (id) => {
      setSelected(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        /* storage unavailable */
      }
    },
    isTenantWide,
    isSchoolAdmin: isTenantWide && user?.role === 'manager',
    isManager: user?.role === 'manager',
    branchName: (id) => branches.data?.find((b) => b.id === id)?.name ?? '—',
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): Scope {
  const s = useContext(Ctx);
  if (!s) throw new Error('useScope must be used inside ScopeProvider');
  return s;
}
