import type { MetadataRoute } from 'next';
import { loadRegistry } from '@/lib/registry';
import { publicSiteOrigin } from '@/lib/site-metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicSiteOrigin();
  if (!origin) return [];

  const registry = loadRegistry();
  const lastModified = new Date(registry.updatedAt);
  const entry = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: new URL(path, origin).toString(),
    lastModified,
    changeFrequency: 'daily',
    priority,
  });

  return [
    entry('/', 1),
    entry('/about', 0.5),
    entry('/programs', 0.9),
    entry('/awards', 0.9),
    entry('/systems', 0.8),
    entry('/orgs', 0.8),
    entry('/brief', 0.8),
    entry('/query', 0.7),
    entry('/method', 0.5),
    ...registry.programs.map((program) => entry(`/programs/${program.id}`, 0.7)),
    ...registry.systems.map((system) => entry(`/systems/${system.id}`, 0.6)),
    ...registry.orgs.map((org) => entry(`/orgs/${org.id}`, 0.6)),
  ];
}
