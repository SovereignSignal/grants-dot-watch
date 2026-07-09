import { redirect } from 'next/navigation';

// The Desk moved under the Privy-gated /admin section.
export default function DeskRedirect() {
  redirect('/admin/desk');
}
