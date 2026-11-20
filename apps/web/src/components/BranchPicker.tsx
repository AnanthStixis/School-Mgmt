import type { ReactNode } from 'react';
import { useScope } from '../lib/scope';

/** Branch switcher for tenant-wide users (shown in the top bar). Branch-bound users see their branch name. */
export function BranchSwitcher() {
  const { branches, branchId, setBranchId, isTenantWide, branchName } = useScope();
  if (!branches.length) return null;
  if (!isTenantWide) return <span className="hidden rounded-full border border-line px-3 py-1 text-sm sm:inline">🏫 {branchName(branchId)}</span>;
  return (
    <select
      aria-label="Branch"
      value={branchId}
      onChange={(e) => setBranchId(e.target.value)}
      className="max-w-[45vw] rounded-full border border-line bg-white px-3 py-1 text-sm"
    >
      <option value="">🏫 All branches ({branches.length})</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

/** Screens that work on one branch at a time ask tenant-wide users to choose one first. */
export function NeedsBranch({ children }: { children: (branchId: string) => ReactNode }) {
  const { branchId, branches, setBranchId } = useScope();
  if (branchId) return <>{children(branchId)}</>;
  return (
    <div className="rounded-card border border-line bg-card p-8 text-center">
      <p className="mb-3 font-semibold">Choose a branch to continue</p>
      <div className="flex flex-wrap justify-center gap-2">
        {branches.map((b) => (
          <button key={b.id} onClick={() => setBranchId(b.id)} className="rounded-lg border border-line px-3 py-2 hover:border-brand">
            {b.name}
          </button>
        ))}
      </div>
    </div>
  );
}
