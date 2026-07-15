import type { MetadataRoute } from 'next';
import { publicSiteUrl } from '@/lib/site-metadata';

export default function robots(): MetadataRoute.Robots {
  const sitemap = publicSiteUrl('/sitemap.xml');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/api/'],
    },
    ...(sitemap ? { sitemap: sitemap.toString() } : {}),
  };
}
