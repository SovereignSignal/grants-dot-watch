'use client';

// The admin panel's owner gate, in two modes:
//   - NEXT_PUBLIC_PRIVY_APP_ID unset: the pre-Privy machine-token form
//     (unchanged UX from the old Desk login), gated by /api/desk/lib's
//     machine path. Dev convenience: with ADMIN_TOKEN also unset outside
//     production, checkAuth() opens automatically and this gate passes
//     without a form.
//   - NEXT_PUBLIC_PRIVY_APP_ID set: "Log in with Privy" (email/Google), then
//     a server-side check that the verified email is in DESK_OWNERS.
// Once past the gate, both tabs (The Desk, Health) render behind one shell.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PrivyProvider, usePrivy, useLogin, useLogout } from '@privy-io/react-auth';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Coord } from '@/components/ui';
import { AdminAuthProvider } from './admin-auth';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

const TABS = [
  { href: '/admin/desk', label: 'The Desk' },
  { href: '/admin/health', label: 'Health' },
];

export function AdminGate({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    return <TokenGate>{children}</TokenGate>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: 'dark' },
        loginMethods: ['email', 'google'],
        embeddedWallets: { ethereum: { createOnLogin: 'off' } },
      }}
    >
      <PrivyGate>{children}</PrivyGate>
    </PrivyProvider>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <div className="starline flex gap-1 pb-4">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`px-3 py-2 text-sm ${
                pathname?.startsWith(t.href) ? 'border-b-2 border-signal text-paper' : 'text-dim hover:text-paper'
              }`}
            >
              {t.label}
            </Link>
          ))}
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
      const res = await fetch('/api/desk/queue', { cache: 'no-store' });
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
      <div className="coord mb-2">ADMIN</div>
      <h1 className="display mb-3 text-2xl font-semibold">The admin panel is the owner&apos;s gate.</h1>
      <p className="mb-6 text-sm text-dim">Enter the admin token to continue.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          autoFocus
          className="w-full rounded-md border border-line bg-surface px-3 py-3 text-paper placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !token}
          className="min-h-11 rounded-md border border-live bg-live/15 font-medium text-live disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-closing">{error}</p>}
    </div>
  );
}

// --- Privy-mode gate ---

function PrivyGate({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const token = await getAccessToken();
      if (!token) return {};
      return { Authorization: `Bearer ${token}` };
    } catch {
      return {};
    }
  }, [getAccessToken]);

  const probe = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/desk/queue', { cache: 'no-store', headers });
      setAuthorized(res.status !== 401 && res.status !== 403);
    } catch {
      setAuthorized(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (ready && authenticated) {
      probe();
    } else if (ready) {
      setAuthorized(null);
    }
  }, [ready, authenticated, probe]);

  if (!ready) return <Loading label="Loading the admin panel…" />;

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-sm px-4 pt-24 pb-16 text-center">
        <div className="coord mb-2">ADMIN</div>
        <h1 className="display mb-3 text-2xl font-semibold">The admin panel is the owner&apos;s gate.</h1>
        <p className="mb-6 text-sm text-dim">Log in to continue.</p>
        <button
          type="button"
          onClick={() => login()}
          className="min-h-11 w-full rounded-md border border-live bg-live/15 font-medium text-live"
        >
          Log in with Privy
        </button>
      </div>
    );
  }

  if (authorized === null) return <Loading label="Checking access…" />;

  if (!authorized) {
    return (
      <div className="mx-auto max-w-sm px-4 pt-24 pb-16 text-center">
        <div className="coord mb-2">ADMIN</div>
        <h1 className="display mb-3 text-2xl font-semibold">Not on the list.</h1>
        <p className="mb-6 text-sm text-dim">This account isn&apos;t in the admin allowlist.</p>
        <button type="button" onClick={() => logout()} className="coord hover:text-dim">
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
