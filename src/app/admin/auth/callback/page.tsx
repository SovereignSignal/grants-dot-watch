'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Coord } from '@/components/ui';

/** The parent AdminGate exchanges and strips Privy's callback before this page renders. */
export default function PrivyCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/desk');
  }, [router]);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-24 pb-16 text-center">
      <Coord>Finishing sign-in…</Coord>
    </div>
  );
}
