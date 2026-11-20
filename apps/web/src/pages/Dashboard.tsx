import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

export function Dashboard() {
  const { user } = useSession();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false });
  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches, retry: false });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {user?.name.split(' ').slice(-2, -1)[0] ?? user?.name} 👋</h1>
        <p className="text-muted">{user?.title}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-line bg-card p-4">
          <h2 className="mb-2 font-semibold">System status</h2>
          {health.isLoading && <p className="text-muted">Checking…</p>}
          {health.isError && <p className="text-red-600">API not reachable – start it with <code>pnpm dev</code>.</p>}
          {health.data && (
            <ul className="space-y-1">
              <li>API: <b className="text-green-700">{health.data.status}</b> (v{health.data.version})</li>
              <li>
                Database:{' '}
                <b className={health.data.db === 'up' ? 'text-green-700' : 'text-red-600'}>{health.data.db}</b>
              </li>
            </ul>
          )}
        </section>

        <section className="rounded-card border border-line bg-card p-4">
          <h2 className="mb-2 font-semibold">Branches</h2>
          {branches.isLoading && <p className="text-muted">Loading…</p>}
          {branches.isError && <p className="text-muted">Unavailable until the database is running and seeded.</p>}
          {branches.data && (
            <ul className="space-y-1.5">
              {branches.data.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: b.color }} />
                  {b.name} <span className="text-muted">· {b.board}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
