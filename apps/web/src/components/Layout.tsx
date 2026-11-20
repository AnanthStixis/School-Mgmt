import { NavLink, Outlet } from 'react-router-dom';
import { ROLE_LABEL, modulesFor } from '@sms/shared';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const mods = modulesFor(user.role);
  let lastGroup = '';

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[252px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col overflow-auto bg-side text-side-ink md:flex">
        <div className="p-4">
          <img
            src={user.role === 'admin' ? '/stixis-logo.png' : '/bnm-logo.png'}
            alt={user.role === 'admin' ? 'Stixis' : 'BNM Public School'}
            className="rounded-lg bg-white p-2"
          />
        </div>
        <nav className="flex-1 px-2.5 pb-4">
          {mods.map((m) => {
            const header = m.group !== lastGroup ? m.group : null;
            lastGroup = m.group;
            return (
              <div key={m.key}>
                {header && (
                  <div className="px-2.5 pt-3.5 pb-1 text-[10.5px] tracking-widest text-side-grp uppercase">{header}</div>
                )}
                <NavLink
                  to={`/${m.key}`}
                  className={({ isActive }) =>
                    `block rounded-[9px] px-2.5 py-2 font-medium ${isActive ? 'bg-brand text-white' : 'hover:bg-side2 hover:text-white'}`
                  }
                >
                  {m.label}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-[#1c2c52] px-3.5 py-3 text-[11px] text-side-grp">Powered by Stixis Technologies</div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-15 items-center gap-3 border-b border-line bg-white px-4 md:px-6">
          <div className="flex-1" />
          <div className="text-right leading-tight">
            <b>{user.name}</b>
            <br />
            <small className="text-muted">{ROLE_LABEL[user.role]}</small>
          </div>
          <button onClick={() => void logout()} className="rounded-lg border border-line px-3 py-1.5 hover:bg-bg">
            Sign out
          </button>
        </header>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
