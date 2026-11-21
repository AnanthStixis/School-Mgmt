import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL, modulesFor } from '@sms/shared';
import { useAuth } from '../lib/auth';
import { BranchSwitcher } from './BranchPicker';
import { NotificationBell } from '../pages/Notifications';

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  // On small screens the sidebar is a slide-in drawer opened from the menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false, staleTime: 300_000 });
  if (!user) return null;
  const mods = modulesFor(user.role);
  let lastGroup = '';

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[252px_1fr] print:block">
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`print:hidden fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-auto bg-side text-side-ink transition-transform md:sticky md:top-0 md:h-screen md:w-auto md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main menu"
      >
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
                {header && <div className="px-2.5 pt-3.5 pb-1 text-[10.5px] tracking-widest text-side-grp uppercase">{header}</div>}
                <NavLink
                  to={`/${m.key}`}
                  className={({ isActive }) => `block rounded-[9px] px-2.5 py-2 font-medium ${isActive ? 'bg-brand text-white' : 'hover:bg-side2 hover:text-white'}`}
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
        <header className="print:hidden sticky top-0 z-20 flex h-15 items-center gap-3 border-b border-line bg-white px-4 md:px-6">
          <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="rounded-lg border border-line px-2.5 py-1.5 md:hidden">
            ☰
          </button>
          <div className="flex-1" />
          <BranchSwitcher />
          <NotificationBell />
          <div className="hidden text-right leading-tight sm:block">
            <b>{user.name}</b>
            <br />
            <small className="text-muted">{ROLE_LABEL[user.role]}</small>
          </div>
          <button onClick={() => void logout()} className="rounded-lg border border-line px-3 py-1.5 whitespace-nowrap hover:bg-bg">
            Sign out
          </button>
        </header>
        {health.data?.testSystem && (
          <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-900 print:hidden" role="status">
            TEST SYSTEM: SMS messages and online payments are simulated. Nothing here is real.
          </div>
        )}
        <main className="p-4 md:p-6 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
