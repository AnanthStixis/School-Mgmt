import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

type Mode = 'staff' | 'family';

const input = 'w-full rounded-lg border border-line bg-white px-3 py-2.5 outline-none focus:border-brand';
const label = 'mb-1 block text-xs font-semibold text-muted';
const primary = 'w-full rounded-lg bg-brand px-4 py-3 font-semibold text-white hover:bg-brand-d disabled:opacity-60';

export function Login() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('staff');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (auth.status === 'signed-in') return <Navigate to="/dashboard" replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitStaff = (e: FormEvent) => {
    e.preventDefault();
    void run(() => auth.loginWithPassword(email, password));
  };

  const submitFamily = (e: FormEvent) => {
    e.preventDefault();
    if (!codeSent) {
      void run(async () => {
        await auth.requestOtp(phone);
        setCodeSent(true);
        setInfo('If this number is registered with the school, we have sent a 6-digit code.');
      });
    } else {
      void run(() => auth.verifyOtp(phone, code));
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-md rounded-card border border-line bg-card p-6 shadow-sm">
        <img src="/bnm-logo.png" alt="BNM Public School" className="mb-6 w-full" />
        <h1 className="mb-4 text-2xl font-bold">Sign in</h1>

        <div className="mb-5 grid grid-cols-2 rounded-lg border border-line bg-bg p-1" role="tablist">
          {(
            [
              ['staff', 'Staff'],
              ['family', 'Parent / Student'],
            ] as const
          ).map(([m, l]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-md py-2 font-semibold ${mode === m ? 'bg-white text-ink shadow-sm' : 'text-muted'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {mode === 'staff' ? (
          <form onSubmit={submitStaff} className="space-y-4">
            <div>
              <label className={label} htmlFor="email">
                E-mail
              </label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label} htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
            </div>
            <button disabled={busy} className={primary}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitFamily} className="space-y-4">
            <div>
              <label className={label} htmlFor="phone">
                Mobile number registered with the school
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="98765 43210"
                required
                disabled={codeSent}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={input}
              />
            </div>
            {codeSent && (
              <div>
                <label className={label} htmlFor="code">
                  6-digit code
                </label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="\d{6}"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className={`${input} tracking-[0.4em]`}
                />
              </div>
            )}
            <button disabled={busy} className={primary}>
              {busy ? 'Please wait…' : codeSent ? 'Verify & sign in' : 'Send code'}
            </button>
            {codeSent && (
              <button
                type="button"
                className="w-full text-sm text-brand"
                onClick={() => {
                  setCodeSent(false);
                  setCode('');
                  setInfo(null);
                }}
              >
                Use a different number
              </button>
            )}
          </form>
        )}

        {info && <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{info}</p>}
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
