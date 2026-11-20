import { Navigate, useParams } from 'react-router-dom';
import { MODULES, canAccess, type ModuleKey } from '@sms/shared';
import { useAuth } from '../lib/auth';

/** Stand-in for modules not built yet, and the lock screen for modules a role can't open. */
export function ModulePlaceholder({ forced }: { forced?: ModuleKey }) {
  const params = useParams();
  const module = forced ?? params.module;
  const { user } = useAuth();
  const m = MODULES.find((x) => x.key === module);
  if (!m || !user) return <Navigate to="/dashboard" replace />;

  if (!canAccess(m, user.role)) {
    return (
      <div className="rounded-card border border-line bg-card p-10 text-center">
        <div className="text-4xl">🔒</div>
        <h2 className="mt-2 text-lg font-semibold">Access restricted</h2>
        <p className="text-muted">Your role cannot open {m.label}.</p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-card p-10 text-center">
      <h1 className="text-xl font-bold">{m.label}</h1>
      <p className="mt-1 text-muted">
        Not built yet – see <code>Poc/{m.key}.html</code> for the agreed design.
      </p>
    </div>
  );
}
