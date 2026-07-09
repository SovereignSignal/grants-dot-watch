'use client';

// `ssr: false` dynamic imports are only allowed from a Client Component in
// the App Router — this tiny wrapper is that boundary so the server page
// (src/app/galaxy/page.tsx) can stay an async Server Component.
import dynamic from 'next/dynamic';

const Galaxy3D = dynamic(() => import('./Galaxy3D'), { ssr: false });

export default function Galaxy3DClient({ focusOrgId }: { focusOrgId: string | null }) {
  return <Galaxy3D focusOrgId={focusOrgId} />;
}
