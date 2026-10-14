'use client';

// The admin panel's owner gate, in two modes:
//   - either public Privy ID unset: the pre-Privy machine-token form
//     (unchanged UX from the old Desk login), gated by /api/desk/lib's
//     machine path. Dev convenience: with ADMIN_TOKEN also unset outside
//     production, checkAuth() opens automatically and this gate passes
//     without a form.
//   - both public Privy IDs set: Privy email OTP login, then
//     a server-side check that the verified email is in DESK_OWNERS.
// Once past the gate, both tabs (The Desk, Health) render behind one shell.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Coord } from '@/components/ui';
import { tabClass } from '@/components/ui-filters';
import { AdminAuthProvider } from './admin-auth';
import {
  bootstrapPrivySession,
  getPrivyAccessToken,
  isPrivyConfigured,
  loginWithPrivyEmail,
  logoutPrivy,
  sendPrivyEmailCode,
} from './privy-core';

const TABS = [
  { href: '/admin/desk', label: 'The Desk' },
  { href: '/admin/health', label: 'Health' },
];

const PUBLIC = [
  { href: '/brief', label: 'Briefing' },
  { href: '/query', label: 'Query' },
];

export function AdminGate({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured) return <TokenGate>{children}</TokenGate>;
  return <PrivyGate>{children}</PrivyGate>;
}

function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-0">
          <div className="flex gap-7">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={tabClass(!!pathname?.startsWith(t.href))}>
                {t.label}
              </Link>
            ))}
          </div>
          <nav aria-label="Live board" className="flex gap-5 pb-px">
            {PUBLIC.map((item) => (
              <Link key={item.href} href={item.href} className="coord text-dim hover:text-paper">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-24 pb-16 text-center">
      <Coord>{label}</Coord>
    </div>
  );
}

// --- Token-mode gate ---

function TokenGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  const probe = useCallback(async () => {
    try {
      const res = await fetch('/api/desk/queue?counts=1', { cache: 'no-store' });
      setAuthed(res.status !== 401);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    probe();
  }, [probe]);

  if (authed === null) return <Loading label="Loading the admin panel…" />;
  if (!authed) return <TokenLoginForm onAuthed={probe} />;

  return (
    <AdminAuthProvider value={{ getAuthHeaders: async () => ({}) }}>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}

function TokenLoginForm({ onAuthed }: { onAuthed: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/desk/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) onAuthed();
      else setError('Wrong token.');
    } catch {
      setError('Could not reach the admin API.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 pt-24 pb-16 text-center">
      <div className="coord mb-4">The Desk</div>
      <h1 className="serif-statement mb-3 text-[26px] leading-[1.28] text-paper">Sign in to review the queue.</h1>
      <p className="mb-8 text-[13.5px] text-dim">Enter the admin token to continue.</p>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          autoFocus
          className="w-full border-b border-line bg-transparent px-1 py-2 text-center text-paper placeholder:text-faint focus:border-paper focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !token}
          className="mx-auto text-[13px] font-bold tracking-[.02em] text-paper underline decoration-1 underline-offset-[3px] disabled:cursor-default disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Enter →'}
        </button>
      </form>
      {error && <p className="mt-4 text-[13px] text-closing">{error}</p>}
    </div>
  );
}

// --- Privy-mode gate ---

function PrivyGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const handleAuthenticated = useCallback((authenticatedUserId: string) => {
    setAuthError(null);
    setAccessError(null);
    setAuthorized(null);
    setUserId(authenticatedUserId);
  }, []);

  useEffect(() => {
    let active = true;
    void bootstrapPrivySession()
      .then((restoredUserId) => {
        if (!active) return;
        setUserId(restoredUserId);
      })
      .catch(() => {
        if (!active) return;
        setUserId(null);
        setAuthError('Could not restore the Privy session. Try signing in again.');
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const token = await getPrivyAccessToken();
      if (!token) {
        setUserId(null);
        setAuthorized(null);
        return {};
      }
      return { Authorization: `Bearer ${token}` };
    } catch {
      return {};
    }
  }, []);

  const probe = useCallback(async () => {
    setAccessError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/desk/queue?counts=1', { cache: 'no-store', headers });
      if (res.ok) setAuthorized(true);
      else if (res.status === 401 || res.status === 403) setAuthorized(false);
      else throw new Error(`Admin API returned ${res.status}`);
    } catch {
      setAuthorized(false);
      setAccessError('Could not verify access with the admin API.');
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (ready && userId) {
      void probe();
    } else if (ready) {
      setAuthorized(null);
    }
  }, [ready, userId, probe]);

  if (!ready) return <Loading label="Loading the admin panel…" />;

  if (!userId) {
    return <PrivyLogin initialError={authError} onAuthenticated={handleAuthenticated} />;
  }

  if (authorized === null) return <Loading label="Checking access…" />;

  if (!authorized) {
    return (
      <div className="mx-auto max-w-sm px-4 pt-24 pb-16 text-center">
        <div className="coord mb-4">The Desk</div>
        <h1 className="display mb-3 text-2xl text-paper">{accessError ? 'Access check failed.' : 'Not on the list.'}</h1>
        <p className="mb-8 text-[13.5px] text-dim">
          {accessError || 'This account isn\'t in the admin allowlist.'}
        </p>
        {accessError && (
          <button type="button" onClick={() => void probe()} className="coord mr-5 underline decoration-line underline-offset-2 hover:text-dim">
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void logoutPrivy().finally(() => {
              setAuthError(null);
              setUserId(null);
              setAuthorized(null);
            });
          }}
          className="coord underline decoration-line underline-offset-2 hover:text-dim"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <AdminAuthProvider value={{ getAuthHeaders }}>
      <AdminShell>{children}</AdminShell>
    </AdminAuthProvider>
  );
}

function PrivyLogin({
  initialError,
  onAuthenticated,
}: {
  initialError: string | null;
  onAuthenticated: (userId: string) => void;
}) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'email' | 'code' | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setBusy('email');
    setError(null);
    try {
      await sendPrivyEmailCode(normalizedEmail);
      setEmail(normalizedEmail);
      setStep('code');
    } catch {
      // The core SDK accepts a CAPTCHA token but does not render the React
      // SDK's challenge UI. Keep CAPTCHA disabled for this email-only flow.
      setError('Could not send a login code. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const normalizedCode = code.replace(/\s/g, '');
    if (!normalizedCode) return;
    setBusy('code');
    setError(null);
    try {
      onAuthenticated(await loginWithPrivyEmail(email, normalizedCode));
    } catch {
      setError('That code could not be verified. Check it and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 pt-24 pb-16 text-center">
      <div className="coord mb-4">The Desk</div>
      <h1 className="serif-statement mb-3 text-[26px] leading-[1.28] text-paper">Sign in to review the queue.</h1>
      <p className="mb-8 text-[13.5px] text-dim">Use an approved email account.</p>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-5">
          <label className="sr-only" htmlFor="privy-email">Email address</label>
          <input
            id="privy-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            autoFocus
            className="w-full border-b border-line bg-transparent px-1 py-2 text-center text-paper placeholder:text-faint focus:border-paper focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null || !email.trim()}
            className="mx-auto text-[13px] font-bold tracking-[.02em] text-paper underline decoration-1 underline-offset-[3px] disabled:cursor-default disabled:opacity-50"
          >
            {busy === 'email' ? 'Sending…' : 'Email me a code →'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="flex flex-col gap-5">
          <p className="text-[13px] text-dim">Code sent to <span className="text-paper">{email}</span>.</p>
          <label className="sr-only" htmlFor="privy-code">One-time code</label>
          <input
            id="privy-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="One-time code"
            autoFocus
            className="w-full border-b border-line bg-transparent px-1 py-2 text-center tracking-[.18em] text-paper placeholder:tracking-normal placeholder:text-faint focus:border-paper focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null || !code.trim()}
            className="mx-auto text-[13px] font-bold tracking-[.02em] text-paper underline decoration-1 underline-offset-[3px] disabled:cursor-default disabled:opacity-50"
          >
            {busy === 'code' ? 'Checking…' : 'Verify code →'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
            className="coord mx-auto text-faint underline decoration-line underline-offset-2 hover:text-dim disabled:opacity-50"
          >
            Use another method
          </button>
        </form>
      )}

      {error && <p className="mt-5 text-[13px] leading-5 text-closing">{error}</p>}
    </div>
  );
}
