import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL } from '@sms/shared';
import { DEMO_USERS, useSession } from '../lib/session';

export function Login() {
  const { signIn } = useSession();
  const nav = useNavigate();
  const [id, setId] = useState(DEMO_USERS[0].id);

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-sm">
        <img src="/bnm-logo.png" alt="BNM Public School" className="mb-6 w-full" />
        <h1 className="mb-1 text-2xl font-bold">Sign in</h1>
        <p className="mb-4 text-muted">Development build – choose a demo persona. Real sign-in comes with the auth module.</p>
        <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="persona">
          Login as
        </label>
        <select
          id="persona"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-line bg-white px-3 py-2.5"
        >
          {DEMO_USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {ROLE_LABEL[u.role]} – {u.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            signIn(id);
            nav('/dashboard');
          }}
          className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-d"
        >
          Login →
        </button>
      </div>
    </div>
  );
}
