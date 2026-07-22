'use client';

import Privy, { LocalStorage } from '@privy-io/js-sdk-core';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

const AUTH_ONLY_LOGIN_OPTIONS = {
  embedded: {
    ethereum: { createOnLogin: 'off' },
    solana: { createOnLogin: 'off' },
  },
} as const;

const OAUTH_PARAMS = ['privy_oauth_code', 'privy_oauth_state', 'privy_oauth_provider'] as const;

let client: Privy | null = null;
let initializeInFlight: Promise<Privy> | null = null;
let bootstrapInFlight: Promise<string | null> | null = null;

export const isPrivyConfigured = Boolean(PRIVY_APP_ID && PRIVY_CLIENT_ID);

function getClient(): Privy {
  if (!PRIVY_APP_ID || !PRIVY_CLIENT_ID) {
    throw new Error('Privy requires both an app ID and a client ID.');
  }
  if (!client) {
    client = new Privy({
      appId: PRIVY_APP_ID,
      clientId: PRIVY_CLIENT_ID,
      storage: new LocalStorage(),
    });
  }
  return client;
}

async function initializeClient(): Promise<Privy> {
  if (initializeInFlight) return initializeInFlight;
  const current = getClient();
  const attempt = current.initialize().then(() => current);
  initializeInFlight = attempt;
  try {
    return await attempt;
  } catch (error) {
    if (initializeInFlight === attempt) initializeInFlight = null;
    throw error;
  }
}

export function readPrivyOAuthCallback(search: string): { code: string | null; state: string | null } | null {
  const params = new URLSearchParams(search);
  if (!OAUTH_PARAMS.some((param) => params.has(param))) return null;
  return {
    code: params.get('privy_oauth_code'),
    state: params.get('privy_oauth_state'),
  };
}

export function stripPrivyOAuthParams(input: URL): string {
  const url = new URL(input);
  for (const param of OAUTH_PARAMS) url.searchParams.delete(param);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

function removeOAuthParams(): void {
  window.history.replaceState(window.history.state, '', stripPrivyOAuthParams(new URL(window.location.href)));
}

async function loadSession(): Promise<string | null> {
  const privy = await initializeClient();
  const callback = readPrivyOAuthCallback(window.location.search);

  if (callback) {
    try {
      if (!callback.code || !callback.state) throw new Error('Privy returned an incomplete OAuth callback.');
      const session = await privy.auth.oauth.loginWithCode(
        callback.code,
        callback.state,
        'google',
        undefined,
        'login-or-sign-up',
        AUTH_ONLY_LOGIN_OPTIONS
      );
      return session.user.id;
    } finally {
      removeOAuthParams();
    }
  }

  const token = await privy.getAccessToken();
  if (!token) return null;
  const { user } = await privy.user.get();
  return user.id;
}

/** Deduplicates React Strict Mode's development effect replay and OAuth code exchange. */
export async function bootstrapPrivySession(): Promise<string | null> {
  if (bootstrapInFlight) return bootstrapInFlight;
  const attempt = loadSession();
  bootstrapInFlight = attempt;
  try {
    return await attempt;
  } finally {
    if (bootstrapInFlight === attempt) bootstrapInFlight = null;
  }
}

export async function sendPrivyEmailCode(email: string): Promise<void> {
  const privy = await initializeClient();
  await privy.auth.email.sendCode(email);
}

export async function loginWithPrivyEmail(email: string, code: string): Promise<string> {
  const privy = await initializeClient();
  const session = await privy.auth.email.loginWithCode(
    email,
    code,
    'login-or-sign-up',
    AUTH_ONLY_LOGIN_OPTIONS
  );
  return session.user.id;
}

export async function beginPrivyGoogleLogin(): Promise<void> {
  const privy = await initializeClient();
  const redirectUri = new URL('/admin/auth/callback', window.location.origin).toString();
  const { url } = await privy.auth.oauth.generateURL('google', redirectUri);
  window.location.assign(url);
}

export async function getPrivyAccessToken(): Promise<string | null> {
  const privy = await initializeClient();
  return privy.getAccessToken();
}

export async function logoutPrivy(): Promise<void> {
  const privy = await initializeClient();
  // Passing userId asks core to clear wallet MFA through the embedded proxy.
  // This auth-only integration deliberately has no wallet iframe.
  await privy.auth.logout();
}
