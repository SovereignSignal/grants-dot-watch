'use client';

// Shared context that hands descendant client components (The Desk's page and
// proposal card) a way to attach whatever auth the current gate mode needs to
// /api/desk/* fetches. Token mode needs nothing extra — the gw_admin cookie
// travels automatically. Privy mode resolves a fresh access token per call.
import { createContext, useContext, type ReactNode } from 'react';

interface AdminAuthContextType {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
  getAuthHeaders: async () => ({}),
});

export function AdminAuthProvider({
  value,
  children,
}: {
  value: AdminAuthContextType;
  children: ReactNode;
}) {
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextType {
  return useContext(AdminAuthContext);
}
