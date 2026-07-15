import type { Metadata } from 'next';

const SITE_NAME = 'grants.watch';

export function publicSiteOrigin(): URL | null {
  const value = (
    process.env.GRANTS_WATCH_PUBLIC_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL
  )?.trim();
  if (!value) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

export function publicSiteUrl(path: string): URL | null {
  const origin = publicSiteOrigin();
  return origin ? new URL(path, origin) : null;
}

export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = publicSiteUrl(path);
  const normalized = description.replace(/\s+/g, ' ').trim();
  const summary = normalized.length > 180 ? `${normalized.slice(0, 177).trimEnd()}...` : normalized;
  return {
    title,
    description: summary,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title,
      description: summary,
      ...(url ? { url } : {}),
    },
    twitter: {
      card: 'summary',
      title,
      description: summary,
    },
  };
}
