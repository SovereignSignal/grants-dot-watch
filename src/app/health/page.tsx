import { redirect } from 'next/navigation';

// Health moved under the Privy-gated /admin section.
export default function HealthRedirect() {
  redirect('/admin/health');
}
