import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'The Desk' };

export default function DeskLayout({ children }: { children: ReactNode }) {
  return children;
}
